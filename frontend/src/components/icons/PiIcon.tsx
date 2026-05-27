import React from "react";
import { Sigma } from "lucide-react";

interface PiIconProps {
  className?: string;
}

export const PiIcon: React.FC<PiIconProps> = ({ className }) => {
  return <Sigma className={className} />;
};
