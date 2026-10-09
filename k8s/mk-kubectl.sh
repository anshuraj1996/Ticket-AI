#!/usr/bin/env bash
# kubectl that runs INSIDE the minikube container (via `docker exec`).
#
# Why: on this machine, antivirus HTTPS scanning intercepts kubectl's TLS
# connection to 127.0.0.1:<apiserver port> and swaps the certificate
# ("x509: certificate signed by unknown authority"). `docker exec` talks to
# Docker over its local pipe, so the interception never happens.
#
# Usage (files are passed on stdin, because host paths don't exist in the container):
#   ./k8s/mk-kubectl.sh get pods -n smartticket
#   kubectl kustomize k8s | ./k8s/mk-kubectl.sh apply -f -
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: don't rewrite /var/... paths

NODE="${MINIKUBE_CONTAINER:-minikube}"
KUBECTL=$(docker exec "$NODE" sh -c 'ls -d /var/lib/minikube/binaries/*/kubectl | tail -1')

exec docker exec -i "$NODE" sudo "$KUBECTL" --kubeconfig=/etc/kubernetes/admin.conf "$@"
