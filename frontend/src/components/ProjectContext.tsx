"use client";

import { createContext, useContext } from "react";

export interface ProjectInfo {
  id: string;
  name: string;
  status: string;
  my_permission?: string;
  agent_role_slug?: string;
  published_version_id?: string | null;
  owner_name?: string;
}

export const ProjectContext = createContext<{
  project: ProjectInfo | null;
  reload: () => void;
}>({ project: null, reload: () => {} });

export const useProject = () => useContext(ProjectContext);
