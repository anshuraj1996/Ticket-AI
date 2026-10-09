# SmartTicket AI on Kubernetes (minikube)

## Layout

```
k8s/
├── kustomization.yaml          # applies everything below into namespace "smartticket"
├── namespace.yaml
├── network-policies.yaml       # default-deny + per-service allow rules
├── infra/                      # dependencies of the backend
│   ├── mongo.yaml              # StatefulSet + headless Service + 2Gi PVC
│   ├── mongo-backup.yaml       # nightly mongodump CronJob + 5Gi backup PVC (7 days kept)
│   ├── kafka.yaml              # single-node KRaft StatefulSet + Service + 2Gi PVC
│   ├── inngest.yaml            # Inngest dev server (dev clusters only)
│   └── redis.yaml              # cache + rate-limit store (no volume, fail-open)
├── backend/
│   ├── configmap.yaml          # non-secret config (Mongo/Kafka/Inngest/Redis)
│   ├── secret.example.yaml     # TEMPLATE ONLY (real Secret comes from .env)
│   ├── deployment.yaml         # API, /readyz + / probes, non-root
│   ├── service.yaml            # backend:3000
│   ├── hpa.yaml                # autoscale 2-5 pods on CPU
│   ├── pdb.yaml                # keep >= 1 pod during node drains
│   └── consumer-deployment.yaml# Kafka audit consumer (same image, other command)
├── frontend/
│   ├── deployment.yaml         # nginx-unprivileged (uid 101, port 8080) + static build
│   ├── service.yaml            # port 80 -> 8080, NodePort 30080
│   ├── hpa.yaml                # autoscale 2-4 pods on CPU
│   ├── pdb.yaml                # keep >= 1 pod during node drains
│   └── ingress.yaml            # http://smartticket.local -> frontend (needs ingress addon)
├── mk-kubectl.sh               # kubectl via `docker exec` into minikube
└── deploy-minikube.sh          # build, load images, secret, apply
```

## How the pieces talk

```
browser ──▶ frontend (nginx, NodePort 30080)
               │ /api/*
               ▼
            backend:3000 ──▶ mongo:27017 ◀── mongo-backup (CronJob, 02:00 daily)
               │   ▲   ├───▶ redis:6379 (user cache, login rate limit)
               │   ▲   └───▶ kafka:9092 ──▶ ticket-consumer ──▶ mongo (audit log)
     events    ▼   │ step callbacks (/api/inngest)
            inngest:8288
```

## Deploy

```bash
cp .env.example .env            # fill in JWT_SECRET, GEMINI_API_KEY, GMAIL_USER, GMAIL_PASS
bash k8s/deploy-minikube.sh     # from the project root, in Git Bash
```

Open the app, either way:
```bash
# A) Ingress: http://smartticket.local
minikube addons enable ingress
minikube tunnel                     # keep running
# hosts file (C:\Windows\System32\drivers\etc\hosts):  127.0.0.1  smartticket.local

# B) NodePort, no extra setup
minikube service frontend -n smartticket --url
```

Prefer Helm? The same app is packaged as a chart in [`helm/smartticket`](../helm/README.md).

Check status:
```bash
bash k8s/mk-kubectl.sh -n smartticket get pods
bash k8s/mk-kubectl.sh -n smartticket logs deploy/backend
bash k8s/mk-kubectl.sh -n smartticket get hpa,pdb,networkpolicy,cronjob
```

## Why `mk-kubectl.sh` instead of plain `kubectl`

On this machine, antivirus HTTPS scanning intercepts kubectl's connection to the
minikube API server on `127.0.0.1` and replaces its certificate, so plain `kubectl`
fails with `x509: certificate signed by unknown authority`.

`mk-kubectl.sh` runs the kubectl binary that ships **inside** the minikube node via
`docker exec`. That goes through Docker's local pipe, so nothing intercepts it.
Host paths don't exist inside the container, so pass manifests on stdin
(`... | bash k8s/mk-kubectl.sh apply -f -`).

On a machine without this problem, plain `kubectl apply -k k8s/` works the same way.

## Images (no registry)

The manifests use `smartticket-backend:1.0.0` / `smartticket-frontend:1.0.0` with
`imagePullPolicy: IfNotPresent`. minikube has its own Docker runtime, so
`deploy-minikube.sh` copies the images in with `docker save | docker exec -i minikube docker load`.
Jenkins does the same with build-number tags and then runs `kubectl set image`.
For a cloud cluster, push the images to a registry and change the `image:` fields.

## Autoscaling (HPA) and disruption budgets (PDB)

| App | HPA | PDB |
|---|---|---|
| backend | 2-5 pods, target 70% CPU of `requests.cpu` (100m) | `minAvailable: 1` |
| frontend | 2-4 pods, target 70% CPU of `requests.cpu` (20m) | `minAvailable: 1` |

- The Deployments have **no `replicas` field**: the HPA owns the count, so `kubectl apply`
  never resets what the autoscaler chose.
- HPAs need metrics-server: `minikube addons enable metrics-server`. Without it, targets show
  `<unknown>` and the HPA just keeps `minReplicas`.
- Scale-down waits 5 minutes of low load (no flapping). Scale-up adds up to 2 pods per minute.

## Network policies

`network-policies.yaml` denies all incoming traffic in the namespace, then allows:

| Pod | Accepts traffic from |
|---|---|
| frontend:8080 | anywhere (public entry point) |
| backend:3000 | frontend, inngest, smoke-test pod (Jenkins) |
| inngest:8288 | backend |
| mongo:27017 | backend, ticket-consumer, mongo-backup |
| kafka:9092 | backend, ticket-consumer |
| redis:6379 | backend |

Egress is open, so DNS and external APIs (Gemini, Gmail) keep working. Policies are only
**enforced** by a CNI that supports them, e.g. `minikube start --cni=calico`. On the default
minikube CNI they are accepted but ignored.

## Pod security

- All app pods run as **non-root** (backend/consumer uid 1000, frontend uid 101, redis uid 999,
  backup uid 999), with `allowPrivilegeEscalation: false` and all Linux capabilities dropped.
- `automountServiceAccountToken: false` everywhere: no pod calls the Kubernetes API, so none
  gets an API token to leak.
- `enableServiceLinks: false` everywhere (and required for Kafka, see `infra/kafka.yaml`).

## Backups

`infra/mongo-backup.yaml` runs `mongodump --gzip --archive` every day at 02:00 into the
`mongo-backups` PVC and deletes archives older than 7 days.

```bash
# Run a backup now
bash k8s/mk-kubectl.sh -n smartticket create job --from=cronjob/mongo-backup mongo-backup-manual
bash k8s/mk-kubectl.sh -n smartticket logs job/mongo-backup-manual

# Restore an archive (replace the file name; --drop overwrites existing collections)
bash k8s/mk-kubectl.sh -n smartticket run mongo-restore --rm -i --restart=Never --image=mongo:7 \
  --labels=app.kubernetes.io/name=mongo-backup \
  --overrides='{"spec":{"volumes":[{"name":"b","persistentVolumeClaim":{"claimName":"mongo-backups"}}],"containers":[{"name":"mongo-restore","image":"mongo:7","stdin":true,"volumeMounts":[{"name":"b","mountPath":"/backups"}],"command":["mongorestore","--uri=mongodb://mongo:27017","--gzip","--drop","--archive=/backups/smartticket-YYYYMMDD-HHMMSS.archive.gz"]}]}}'
```

## Production notes

- Replace `infra/inngest.yaml` with Inngest Cloud: remove `INNGEST_DEV` / `INNGEST_BASE_URL`
  from the ConfigMap and add `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` to the Secret.
- Use managed MongoDB/Kafka (or operators) instead of the single-replica StatefulSets.
  Enable MongoDB authentication and move `MONGO_URI` (with credentials) into the Secret.
- Copy backups off the cluster (S3/GCS), since a PVC on the same cluster is not disaster recovery.
- Set `APP_URL` in the ConfigMap to the public URL.
