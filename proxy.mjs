// proxy.mjs — entry point mong. Logic nam trong src/ (xem src/server.js).
import { start } from "./src/server.js";
import { loadRuntime } from "./src/config.js";

loadRuntime(); // khoi phuc backend/model cu tu file local (neu co)
start();
