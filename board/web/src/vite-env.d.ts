/// <reference types="vite/client" />
declare module "virtual:repo-data" {
  const data: unknown;
  export default data;
}
interface ImportMetaEnv {
  readonly VITE_BOARD_API?: string;
}
