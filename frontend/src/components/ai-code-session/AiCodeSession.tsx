import React from "react";
import { SessionController } from "./SessionController";
import type { AiCodeSessionProps } from "./types";

export const AiCodeSession: React.FC<AiCodeSessionProps> = (props) => (
  <SessionController {...props} />
);
