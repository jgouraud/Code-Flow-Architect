#!/usr/bin/env python3
"""Read-only heuristic audit of a protected-web Docker Compose topology.

Not a security scanner and does not contact Docker. Requires PyYAML.
Example:
 python tools/audit_docker_topology.py compose.yaml --app frontend --gateway gateway --auth auth --updater data-updater --nginx nginx.conf
"""
from __future__ import annotations
import argparse
from pathlib import Path
import sys


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('compose',type=Path)
    p.add_argument('--app',default='frontend')
    p.add_argument('--gateway',default='gateway')
    p.add_argument('--auth',default='auth')
    p.add_argument('--updater',default='data-updater')
    p.add_argument('--nginx',type=Path)
    args=p.parse_args()
    try:
        import yaml
    except ImportError:
        print('ERROR: PyYAML is required for static Compose parsing; install only in an approved environment.',file=sys.stderr)
        return 2
    try:
        model=yaml.safe_load(args.compose.read_text(encoding='utf-8'))
    except (OSError,yaml.YAMLError) as e:
        print(f'ERROR: cannot parse {args.compose}: {e}',file=sys.stderr)
        return 2
    if not isinstance(model,dict) or not isinstance(model.get('services'),dict):
        print('ERROR: Compose file needs a services: object',file=sys.stderr)
        return 2
    services=model['services']
    errors=[]; warnings=[]
    for name in (args.app,args.gateway,args.auth,args.updater):
        if name not in services:
            errors.append(f'missing service {name!r}; specify its name via --app/--gateway/--auth/--updater')
    def networks(name):
        v=services.get(name,{})
        nets=v.get('networks')
        if not nets:return {'default'}
        if isinstance(nets,list):return set(nets)
        if isinstance(nets,dict):return set(nets)
        return set()
    def publications(name):
        d=services.get(name,{})
        return d.get('ports') or []
    for name in (args.app,args.auth,args.updater):
        if publications(name):errors.append(f'{name}: host-published ports may bypass the authenticated gateway: {publications(name)!r}')
        if services.get(name,{}).get('network_mode')=='host':errors.append(f'{name}: network_mode: host bypasses ordinary network isolation')
    if args.gateway in services and not publications(args.gateway):
        warnings.append(f'{args.gateway}: no published port; okay if an external ingress attaches differently, otherwise unreachable')
    if args.app in services and args.gateway in services and not (networks(args.app)&networks(args.gateway)):
        errors.append('gateway and app have no shared Compose network')
    if args.gateway in services and args.auth in services and not (networks(args.gateway)&networks(args.auth)):
        errors.append('gateway and auth have no shared Compose network')
    if args.app in services and args.auth in services and (networks(args.app)&networks(args.auth)):
        warnings.append('auth and application share a network; consider separating access-path blast radius')
    app=services.get(args.app,{})
    up=services.get(args.updater,{})
    if up and not up.get('profiles'):
        warnings.append('updater has no profile; an update job may launch as a long-lived default service')
    if up and up.get('restart') not in ('no',None):
        warnings.append('updater restart policy is not `no`; confirm correct one-shot job behavior')
    def mounts(d):
        result={}
        for m in d.get('volumes',[]) or []:
            if isinstance(m,str):
                parts=m.split(':')
                if len(parts)>=2:result[parts[0]]={'ro':'ro' in parts[2:]}
            elif isinstance(m,dict):
                result[m.get('source') or '']= {'ro':bool(m.get('read_only'))}
        return result
    app_mounts=mounts(app); up_mounts=mounts(up)
    shared=set(app_mounts)&set(up_mounts)
    if up and app and not shared:
        warnings.append('app/updater have no common named or host storage path; confirm artifact publication strategy')
    for name in sorted(shared):
        if not app_mounts[name]['ro']:
            warnings.append(f'app shared mount {name!r} is writable; consider readonly if app does not write')
        if up_mounts[name]['ro']:
            errors.append(f'updater shared mount {name!r} is readonly; cannot publish data through it')
    for pub in publications(args.gateway):
        if isinstance(pub,str) and pub.count(':')==1:
            warnings.append(f'gateway port {pub!r} binds all host interfaces by default; confirm public ingress ownership')
        if isinstance(pub,dict) and not pub.get('host_ip'):
            warnings.append('gateway long-form published port has no host_ip; confirm acceptable external scope')
    for n,details in (model.get('networks') or {}).items():
        if n in networks(args.app) and n in networks(args.gateway) and isinstance(details,dict) and not details.get('internal',False):
            warnings.append(f'app network {n!r} is not marked internal: true; confirm egress/ingress restrictions')
    if args.nginx:
        try: ng=args.nginx.read_text(encoding='utf-8')
        except OSError as e:
            errors.append(f'cannot read Nginx configuration: {e}')
        else:
            if 'auth_request /oauth2/auth;' not in ng:
                warnings.append('Nginx config lacks exact auth_request /oauth2/auth; verify all protected routes')
            if '$http_x_forwarded_host' in ng or '$http_x_forwarded_proto' in ng:
                warnings.append('Nginx references received forwarded host/proto headers; validate trusted reverse-proxy sanitization')
    print(f'Checked {args.compose} (static heuristic only; no runtime network/auth tests)')
    for x in errors:print('ERROR:',x)
    for x in warnings:print('WARN: ',x)
    if errors:return 1
    print('PASS: No direct app/auth/updater port publication or missing required shared networks detected.')
    return 0

if __name__=='__main__':sys.exit(main())
