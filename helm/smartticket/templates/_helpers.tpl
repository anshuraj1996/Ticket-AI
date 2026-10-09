{{/* Labels shared by every object */}}
{{- define "smartticket.labels" -}}
app.kubernetes.io/part-of: smartticket
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{/* Pod template labels (stable across upgrades, no chart version) */}}
{{- define "smartticket.podLabels" -}}
app.kubernetes.io/part-of: smartticket
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "smartticket.backendImage" -}}
{{ .Values.images.backend.repository }}:{{ .Values.images.backend.tag | default .Chart.AppVersion }}
{{- end }}

{{- define "smartticket.frontendImage" -}}
{{ .Values.images.frontend.repository }}:{{ .Values.images.frontend.tag | default .Chart.AppVersion }}
{{- end }}

{{- define "smartticket.secretName" -}}
{{ .Values.secrets.existingSecret | default "backend-secrets" }}
{{- end }}

{{/* Pod-level hardening shared by app pods */}}
{{- define "smartticket.podDefaults" -}}
enableServiceLinks: false
automountServiceAccountToken: false
{{- end }}

{{/* Container-level hardening */}}
{{- define "smartticket.containerSecurity" -}}
securityContext:
  allowPrivilegeEscalation: false
  capabilities:
    drop: ["ALL"]
{{- end }}

{{/* Init container: wait for the enabled dependencies (mongoose does not retry its first connect) */}}
{{- define "smartticket.waitForDeps" -}}
- name: wait-for-deps
  image: {{ .Values.images.busybox }}
  command:
    - sh
    - -c
    - |
      {{- if .Values.mongo.enabled }}
      until nc -z mongo 27017; do echo "waiting for mongo"; sleep 2; done
      {{- end }}
      {{- if .Values.kafka.enabled }}
      until nc -z kafka 9092; do echo "waiting for kafka"; sleep 2; done
      {{- end }}
      echo "dependencies ready"
  resources:
    requests: { cpu: 10m, memory: 16Mi }
    limits: { memory: 32Mi }
{{- end }}
