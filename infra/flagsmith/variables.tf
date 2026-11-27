variable "base_api_url" {
  description = "Flagsmith Admin API base URL."
  type        = string
  default     = "https://api.flagsmith.com/api/v1"
}

variable "project_uuid" {
  description = "UUID of the fork-in-the-bill project (id 56673). drift.sh looks it up when unset."
  type        = string
}

variable "environment_key" {
  description = "Client-side key of the Production environment. drift.sh reads it from flagsmith.json when unset."
  type        = string
}

variable "experiment_segment_id" {
  description = "Id of the system segment Flagsmith created for experiment 822 (experiment-822-rollout)."
  type        = number
  default     = 1206056
}
