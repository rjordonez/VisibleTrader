#!/bin/bash
# Deploys the current main branch to the prod VM: pulls latest, restarts the
# live-signal-service, confirms it comes back healthy. Replaces the manual
# SSH -> git pull -> systemctl restart -> systemctl status dance with one
# command. Push to main first — this only deploys what's already on GitHub.
set -e

gcloud compute ssh visibletraderhq@instance-20260801-214922 --zone=us-central1-a --quiet \
  --command="cd ~/venter && git pull && sudo systemctl restart live-signal-service && sleep 3 && sudo systemctl status live-signal-service --no-pager"
