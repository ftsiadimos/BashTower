# Bash Tower

**Bash Tower** is a lightweight, web‑based UI for running Bash scripts and ad‑hoc SSH commands across multiple hosts.  
It is aimed at home‑lab enthusiasts, small teams, or anyone who needs a simple way to orchestrate tasks without the overhead of full‑blown automation platforms.

## Table of Contents

- [Features](#features)
- [Demo](#demo)
- [Architecture](#architecture)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)

## Features

| ✅ | Description |
|---|---|
| **Multi‑host execution** | Run any Bash script on a selected set of hosts via SSH. |
| **Template library** | Save reusable script templates (with syntax‑highlighted editor). |
| **Host & group management** | Organise hosts into logical groups for bulk operations. |
| **SSH key storage** | Store private keys (unencrypted – demo only) for password‑less login. |
| **Job history & logs** | View real‑time stdout/stderr for each job, with error analysis. |
| **Red Hat Satellite sync** | Pull host inventory from Satellite API and auto‑populate the DB. |
| **Responsive UI** | Tailwind CSS + Vue 3 provides a clean, mobile‑friendly interface. |
| **Docker ready** | Official Docker image for quick deployment. |

## Demo

```bash
# Clone the repo
git clone https://github.com/ftsiadimos/BashTower.git
cd BashTower

# Pull the pre‑built image
docker pull ftsiadimos/bashtower

# Run the container (exposes port 8000)
docker run -d \
  --name bashtower \
  -p 8000:8000 \
  -v $(pwd)/instance:/app/instance \
  ftsiadimos/bashtower
```

## Architecture

```
┌─────────────────────┐
│   Front‑end (Vue)   │  <-- static assets (HTML fragments, CSS, JS)
└─────────▲───────────┘
          │
          │ HTTP
          ▼
┌─────────────────────┐
│   Flask (Python)    │  <-- REST API, job scheduler, DB access
│   • /api/* endpoints│
│   • SQLite / Postgre│
└─────────▲───────────┘
          │
          │ SSH
          ▼
┌─────────────────────┐
│   Remote hosts      │  <-- Bash scripts executed via paramiko/ssh
└─────────────────────┘
```

Installation
Prerequisites
Docker Engine (no need for Docker Compose).
(Optional) A Red Hat Satellite instance for host sync.
Option – Docker (quick start)

```
# Clone the repo

git clone https://github.com/ftsiadimos/BashTower.git
cd BashTower

# Create a virtual environment

python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r [requirements.txt]

# Initialise the DB
flask db upgrade   # creates SQLite DB at instance/bashtower.sqlite

# Run the server
flask run --host=0.0.0.0 --port=8000

```

# Usage
- Log in – No authentication is implemented in the demo (open to anyone on the network).
- Add hosts – Provide name, hostname/IP, SSH user, and port.
- Add SSH keys – Paste a private key (RSA/PEM).
- Create a template – Write a Bash script, give it a name, and save.
- Run a job – Select a template, pick one or more hosts/groups, and click Run.
- Monitor output – The UI polls the back‑end for logs; errors can be sent to the built‑in analyzer.
- Satellite sync (optional) – Fill the Satellite URL and credentials, then click Sync Hosts Now.




# Contributing
1. Fork the repository.
2. Create a feature branch (git checkout -b feat/my‑feature).
3. Write code and tests.
4. Ensure pytest passes and linting (flake8) reports no errors.
5. Open a Pull Request with a clear description of the change.
6. Please adhere to the existing code style and include documentation updates where appropriate.


# License
This project is licensed under the GPL-3.0 license – see the LICENSE file for details.