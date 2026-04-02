import React from "react";
import type { main } from "@/lib/api";

interface SkillPickerProps {
  /**
   * The project path for loading project-specific skills
   */
  projectPath?: string;
  /**
   * Callback when a skill is selected
   */
  onSelect: (skill: main.Skill) => void;
  /**
   * Callback to close the picker
   */
  onClose: () => void;
  /**
   * Initial search query (text after :)
   */
  initialQuery?: string;
  /**
   * Optional className for styling
   */
  className?: string;
  /**
   * Optional anchor element ref for positioning the picker
   */
  anchorRef?: React.RefObject<HTMLElement>;
}

/**
 * SkillPicker is intentionally disabled for Claude picker discovery.
 * Claude capability discovery now flows through ClaudeCapabilityPicker.
 * This component remains only as a compatibility shim for legacy callers.
 */
export const SkillPicker: React.FC<SkillPickerProps> = ({ onClose }) => {
  React.useEffect(() => {
    onClose();
  }, [onClose]);

  return null;
};
