# SmartTicket AI Helm Chart

`helm/smartticket` packages the same resources as [`k8s/`](../k8s) (Kustomize), but every
setting comes from `values.yaml`, so one chart serves dev, staging and production.

| | Kustomize (`k8s/`) | Helm (`helm/smartticket`) |
|---|---|---|
| Used by | `deploy-minikube.sh`, Jenkinsfile | Manual installs, multi-environment deploys |
| Config | Edit YAML / patches | `values.yaml` + `-f values-<env>.yaml` / `--set` |
| Toggle parts | Edit `kustomization.yaml` | `kafka.enabled`, `ingress.enabled`, ... |
| Upgrades / rollback | `kubectl apply` | `helm upgrade`, `helm rollback` (release history) |

Use **one** of them per namespace, not both.

## Install (minikube)

```bash
# 1) Images into minikube (no registry)
docker build -t smartticket-backend:1.0.0 BACKEND
docker build -t smartticket-frontend:1.0.0 FRONTEND
docker save smartticket-backend:1.0.0  | docker exec -i minikube docker load
docker save smartticket-frontend:1.0.0 | docker exec -i minikube docker load

# 2) Secret from your .env (keeps real values out of values files)
kubectl create namespace smartticket
kubectl -n smartticket create secret generic backend-secrets --from-env-file=.env

# 3) Install / upgrade
helm upgrade --install smartticket helm/smartticket -n smartticket \
  --set secrets.existingSecret=backend-secrets
```

Useful commands:
```bash
helm lint helm/smartticket                         # validate the chart
helm template smartticket helm/smartticket \
  --set secrets.jwtSecret=dummy | less             # render without a cluster
helm -n smartticket history smartticket            # release history
helm -n smartticket rollback smartticket 1         # roll back to revision 1
helm -n smartticket uninstall smartticket          # remove (backup PVC is kept)
```

### On this machine (antivirus blocks kubectl/helm → API server)

Helm talks to the API server over HTTPS just like kubectl, so it hits the same certificate
interception. Render locally and apply through `mk-kubectl.sh` instead:

```bash
helm template smartticket helm/smartticket -n smartticket \
  --set secrets.existingSecret=backend-secrets \
  | bash k8s/mk-kubectl.sh -n smartticket apply -f -
```

(`helm template` needs no cluster access. Release history/rollback are not available this way.)

## Key values

| Value | Default | Description |
|---|---|---|
| `images.backend.repository` / `.tag` | `smartticket-backend` / appVersion | Backend + consumer image |
| `images.frontend.repository` / `.tag` | `smartticket-frontend` / appVersion | Frontend image |
| `secrets.existingSecret` | `""` | Use an existing Secret (recommended) |
| `secrets.jwtSecret` | `""` | Required if no `existingSecret` |
| `config.kafkaBrokers` / `config.redisUrl` | in-cluster services | `""` turns the feature off in the app |
| `backend.autoscaling.*` | 2-5 pods, 70% CPU | HPA (needs metrics-server) |
| `frontend.service.type` | `NodePort` (30080) | `ClusterIP` when only using the Ingress |
| `ingress.enabled` / `.host` | `true` / `smartticket.local` | nginx Ingress |
| `ingress.tls.enabled` | `false` | HTTPS with `ingress.tls.secretName` |
| `networkPolicies.enabled` | `true` | Default-deny + per-service allow rules |
| `mongo.enabled`, `kafka.enabled`, `redis.enabled`, `inngest.enabled` | `true` | Deploy the dependency in-cluster |
| `mongo.backup.*` | daily 02:00, 7 days | `mongodump` CronJob |

See [`values-prod.example.yaml`](smartticket/values-prod.example.yaml) for a production setup:
registry images, managed MongoDB/Kafka/Redis, Inngest Cloud, HTTPS via cert-manager.

## Notes

- Resource names are fixed (`backend`, `mongo`, `kafka`, ...) because the frontend nginx and the
  Inngest dev server address them by name. Install **one release per namespace**.
- Pods restart automatically when the ConfigMap/Secret rendered by the chart changes
  (`checksum/config` annotation).
- The `mongo-backups` PVC has `helm.sh/resource-policy: keep`, so `helm uninstall` never deletes backups.
