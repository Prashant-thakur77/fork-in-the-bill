// Flagsmith's identity bucketing. The implementation lives in the TypeScript kit, so the site,
// the kit and the MCP server all hash with the same code.
export { hashedPercentage, md5 } from "../../../../kit/ts/src/bucket";
