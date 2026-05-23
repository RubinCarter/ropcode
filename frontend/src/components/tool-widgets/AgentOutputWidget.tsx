import React from 'react';

export const AgentOutputWidget: React.FC<{ output?: string }> = ({ output }) => (
  <pre className="whitespace-pre-wrap text-xs">{output ?? ''}</pre>
);
