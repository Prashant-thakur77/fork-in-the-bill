# The Flagsmith configuration experiment 822 runs on, as it is live. The CLI scripts
# (flagsmith/setup.sh, create_experiment.sh, start_experiment.sh) created all of it; this file
# only describes it, so that `terraform plan` reports any change made outside those scripts.

locals {
  control_policy  = trimspace(file("${path.module}/../../flagsmith/policies/control.json"))
  lanes_v1_policy = trimspace(file("${path.module}/../../flagsmith/policies/lanes_v1.json"))
}

resource "flagsmith_feature" "agent_routing" {
  project_uuid    = var.project_uuid
  feature_name    = "agent_routing"
  type            = "MULTIVARIATE"
  description     = "Routing policy JSON for the agent's main and delegate lanes"
  default_enabled = true
  initial_value   = local.control_policy
  is_archived     = false
}

resource "flagsmith_feature" "routing_kill" {
  project_uuid    = var.project_uuid
  feature_name    = "routing_kill"
  type            = "STANDARD"
  description     = "On: every task runs the control policy and records no exposure"
  default_enabled = false
  is_archived     = false
}

# The provider has no `key` attribute, so the variant key "lanes_v1" is owned by setup.sh.
resource "flagsmith_mv_feature_option" "lanes_v1" {
  feature_uuid                  = flagsmith_feature.agent_routing.uuid
  type                          = "unicode"
  string_value                  = local.lanes_v1_policy
  default_percentage_allocation = 0
}

# Environment defaults (Production).
resource "flagsmith_feature_state" "agent_routing" {
  environment_key = var.environment_key
  feature_id      = flagsmith_feature.agent_routing.id
  enabled         = true
  feature_state_value = {
    type         = "unicode"
    string_value = local.control_policy
  }
}

resource "flagsmith_feature_state" "routing_kill" {
  environment_key = var.environment_key
  feature_id      = flagsmith_feature.routing_kill.id
  enabled         = false
  feature_state_value = {
    type         = "unicode"
    string_value = ""
  }
}

# The experiment's rollout: a segment override on Flagsmith's system segment for experiment 822.
# Its value is control. The 50% lanes_v1 weight on it is set by create_experiment.sh, because the
# provider cannot express per-segment variant weights.
resource "flagsmith_feature_state" "agent_routing_experiment_822" {
  environment_key  = var.environment_key
  feature_id       = flagsmith_feature.agent_routing.id
  segment_id       = var.experiment_segment_id
  segment_priority = 0
  enabled          = true
  feature_state_value = {
    type         = "unicode"
    string_value = local.control_policy
  }
}
