#!/usr/bin/env python3
"""
LocalForge CLI — helper for agents to interact with the LocalForge REST API
without bash/curl quoting issues.

Usage:
    python lf.py <command> [options]

Commands:
    health                                  Check server connectivity
    projects                                List all projects
    project-get <id>                        Get a single project
    project-create --file <json>            Create a project
    project-update <id> --file <json>       Update a project
    project-delete <id>                     Delete a project

    features <project_id>                   List features for a project
    feature-get <id>                        Get a single feature
    feature-create <project_id> --file <f>  Create a feature
    feature-update <id> --file <json>       Update a feature
    feature-delete <id>                     Delete a feature
    feature-create-bulk <pid> --file <f>    Create many features from a JSON array

    deps-list <feature_id>                  List dependencies
    deps-set <feature_id> --file <json>     Bulk-replace dependencies
    deps-delete <fid> <depends_on_id>       Remove one dependency

Options:
    --file <path>       Path to a JSON file with the request body
    --base <url>        Base URL (default: http://localhost:7777)

The --file flag is the key advantage: agents write JSON to a temp file first,
then pass the path here. No shell quoting needed.
"""

import json
import sys
import urllib.request
import urllib.error


DEFAULT_BASE = "http://localhost:7777"


def request(method, url, data=None, quiet=False):
    body = json.dumps(data).encode() if data else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode())
            if not quiet:
                print(json.dumps(result, indent=2))
            return result
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode())
        except Exception:
            err_body = {"error": e.reason, "status": e.code}
        if not quiet:
            print(json.dumps(err_body, indent=2), file=sys.stderr)
        return err_body
    except urllib.error.URLError as e:
        print(json.dumps({"error": f"Cannot reach server: {e.reason}"}, indent=2), file=sys.stderr)
        sys.exit(1)


def load_json_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_args(argv):
    args = {"command": None, "positional": [], "file": None, "base": DEFAULT_BASE}
    i = 0
    while i < len(argv):
        if argv[i] == "--file" and i + 1 < len(argv):
            args["file"] = argv[i + 1]
            i += 2
        elif argv[i] == "--base" and i + 1 < len(argv):
            args["base"] = argv[i + 1].rstrip("/")
            i += 2
        elif args["command"] is None:
            args["command"] = argv[i]
            i += 1
        else:
            args["positional"].append(argv[i])
            i += 1
    return args


def require_file(args):
    if not args["file"]:
        print('Error: --file <path> is required for this command', file=sys.stderr)
        sys.exit(1)
    return load_json_file(args["file"])


def require_pos(args, index, name):
    if index >= len(args["positional"]):
        print(f'Error: missing required argument <{name}>', file=sys.stderr)
        sys.exit(1)
    return args["positional"][index]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    args = parse_args(sys.argv[1:])
    base = args["base"]
    cmd = args["command"]

    if cmd == "health":
        request("GET", f"{base}/api/health")

    elif cmd == "projects":
        request("GET", f"{base}/api/projects")

    elif cmd == "project-get":
        pid = require_pos(args, 0, "project_id")
        request("GET", f"{base}/api/projects/{pid}")

    elif cmd == "project-create":
        data = require_file(args)
        request("POST", f"{base}/api/projects", data)

    elif cmd == "project-update":
        pid = require_pos(args, 0, "project_id")
        data = require_file(args)
        request("PATCH", f"{base}/api/projects/{pid}", data)

    elif cmd == "project-delete":
        pid = require_pos(args, 0, "project_id")
        request("DELETE", f"{base}/api/projects/{pid}")

    elif cmd == "features":
        pid = require_pos(args, 0, "project_id")
        request("GET", f"{base}/api/projects/{pid}/features")

    elif cmd == "feature-get":
        fid = require_pos(args, 0, "feature_id")
        request("GET", f"{base}/api/features/{fid}")

    elif cmd == "feature-create":
        pid = require_pos(args, 0, "project_id")
        data = require_file(args)
        request("POST", f"{base}/api/projects/{pid}/features", data)

    elif cmd == "feature-update":
        fid = require_pos(args, 0, "feature_id")
        data = require_file(args)
        request("PATCH", f"{base}/api/features/{fid}", data)

    elif cmd == "feature-delete":
        fid = require_pos(args, 0, "feature_id")
        request("DELETE", f"{base}/api/features/{fid}")

    elif cmd == "feature-create-bulk":
        pid = require_pos(args, 0, "project_id")
        features = require_file(args)
        if not isinstance(features, list):
            print('Error: --file must contain a JSON array of features', file=sys.stderr)
            sys.exit(1)
        created = []
        errors = []
        for i, feat in enumerate(features):
            print(f"Creating feature {i+1}/{len(features)}: {feat.get('title', '?')}...", file=sys.stderr)
            result = request("POST", f"{base}/api/projects/{pid}/features", feat, quiet=True)
            if result and "feature" in result:
                created.append(result["feature"])
            else:
                errors.append({"index": i, "title": feat.get("title", "?"), "error": result})
        print(f"Created {len(created)}/{len(features)} features.", file=sys.stderr)
        summary = {"created": created, "errors": errors}
        print(json.dumps(summary, indent=2))

    elif cmd == "deps-list":
        fid = require_pos(args, 0, "feature_id")
        request("GET", f"{base}/api/features/{fid}/dependencies")

    elif cmd == "deps-set":
        fid = require_pos(args, 0, "feature_id")
        data = require_file(args)
        request("POST", f"{base}/api/features/{fid}/dependencies", data)

    elif cmd == "deps-delete":
        fid = require_pos(args, 0, "feature_id")
        dep_id = require_pos(args, 1, "depends_on_id")
        request("DELETE", f"{base}/api/features/{fid}/dependencies?dependsOnFeatureId={dep_id}")

    else:
        print(f'Unknown command: {cmd}', file=sys.stderr)
        print('Run without arguments for usage.', file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
