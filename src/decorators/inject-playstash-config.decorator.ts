import { Inject } from "@nestjs/common";

import { PLAYSTASH_CONFIG } from "../playstash-config.js";

export const InjectPlaystashConfig = () => Inject(PLAYSTASH_CONFIG);
