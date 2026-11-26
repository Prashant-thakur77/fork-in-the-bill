variable "region" {
  description = "AWS region for every resource."
  type        = string
  default     = "us-east-1"
}

variable "name" {
  description = "Name prefix for resources."
  type        = string
  default     = "fork-in-the-bill"
}

variable "operator_cidr" {
  description = "The only CIDR allowed to reach SSH, e.g. \"203.0.113.7/32\"."
  type        = string

  validation {
    condition     = can(cidrhost(var.operator_cidr, 0)) && var.operator_cidr != "0.0.0.0/0"
    error_message = "operator_cidr must be a valid CIDR and must not be 0.0.0.0/0."
  }
}

variable "ssh_public_key" {
  description = "OpenSSH public key for the `ubuntu` user (contents, not a path)."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type. m7i.4xlarge = 16 vCPU / 64 GiB: about 2 vCPU and 6 GiB per task container at 8 in parallel, with room for Redis, ClickHouse and the collector."
  type        = string
  default     = "m7i.4xlarge"
}

variable "use_spot" {
  description = "Run as a one-time spot instance. Set to false to fall back to on-demand when spot capacity is short."
  type        = bool
  default     = true
}

variable "spot_max_price" {
  description = "Optional spot price ceiling in USD/hour. Empty means capped at the on-demand price."
  type        = string
  default     = ""
}

variable "root_volume_gb" {
  description = "Size of the gp3 root volume in GiB. SWE-bench-Live task images are large; Docker data lives here."
  type        = number
  default     = 400

  validation {
    condition     = var.root_volume_gb >= 50 && var.root_volume_gb <= 16384
    error_message = "root_volume_gb must be between 50 and 16384."
  }
}

variable "root_volume_iops" {
  description = "Provisioned IOPS for the gp3 root volume (3000 is included in the base price)."
  type        = number
  default     = 3000
}

variable "root_volume_throughput" {
  description = "Provisioned throughput for the gp3 root volume in MiB/s (125 is included in the base price)."
  type        = number
  default     = 125
}

variable "repo_url" {
  description = "HTTPS URL of the repository to clone onto the instance. Must be readable without credentials."
  type        = string
}

variable "repo_ref" {
  description = "Branch, tag or commit to check out after cloning."
  type        = string
  default     = "main"
}

variable "uv_version" {
  description = "uv release installed on the instance."
  type        = string
  default     = "0.10.9"
}

variable "prepull_images" {
  description = "Container images (ideally pinned by digest) pulled at boot so the first tasks do not wait on registry downloads."
  type        = list(string)
  default     = []
}

variable "budget_usd" {
  description = "Monthly AWS cost budget in USD. An email goes out when actual spend crosses it, and earlier at 80% forecast."
  type        = number

  validation {
    condition     = var.budget_usd > 0
    error_message = "budget_usd must be positive."
  }
}

variable "budget_email" {
  description = "Email address that receives the budget alerts. Empty: the budget is created without email alerts."
  type        = string
  default     = ""
}
