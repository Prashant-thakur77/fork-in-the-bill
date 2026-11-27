# Adopt the live objects into local state. Ids come from read-only Admin API GETs
# (README.md lists them). drift.sh also runs `terraform import` (state only) on a fresh
# checkout; once a resource is in state its import block is a no-op.

import {
  to = flagsmith_feature.agent_routing
  id = "69f8b5ca-3e61-4d80-aabf-2a5bd35bdf0c"
}

import {
  to = flagsmith_feature.routing_kill
  id = "37b48a8e-69bf-4249-971d-b3d3f4a5f020"
}

import {
  to = flagsmith_mv_feature_option.lanes_v1
  id = "69f8b5ca-3e61-4d80-aabf-2a5bd35bdf0c,e83f10f5-e34c-4e7e-a20b-cd9a3bf32db1"
}

import {
  to = flagsmith_feature_state.agent_routing
  id = "${var.environment_key},426a4583-0ae1-4fce-90a6-f05d7775b360"
}

import {
  to = flagsmith_feature_state.routing_kill
  id = "${var.environment_key},78107960-2ee5-40ce-84eb-a654a9d4f9ac"
}

import {
  to = flagsmith_feature_state.agent_routing_experiment_822
  id = "${var.environment_key},7f4557f9-fc59-4e49-bf9c-1db1e83b512f"
}
