terraform {
  required_version = ">= 1.9.0"

  required_providers {
    flagsmith = {
      source  = "Flagsmith/flagsmith"
      version = "~> 0.12"
    }
  }

  # Local state only (gitignored). This configuration is never applied during an
  # experiment; it exists so `terraform plan` can show drift. See README.md.
  backend "local" {
    path = "terraform.tfstate"
  }
}

# The master API key comes from FLAGSMITH_MASTER_API_KEY (drift.sh maps it from .env).
provider "flagsmith" {
  base_api_url = var.base_api_url
}
