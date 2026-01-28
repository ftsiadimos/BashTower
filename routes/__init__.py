# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - Routes Package
# ============================================================================

from routes.templates import templates_bp
from routes.hosts import hosts_bp
from routes.groups import groups_bp
from routes.keys import keys_bp
from routes.jobs import jobs_bp
from routes.satellite import satellite_bp
from routes.cronjobs import cronjobs_bp
from routes.cronhistory import cronhistory_bp
from routes.settings import settings_bp
