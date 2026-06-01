import React from 'react';

const tabs = [
  'General',
  'Permissions',
  'Environment',
  'Advanced',
  'Hooks',
  'Commands',
  'Agents',
  'Plugins',
  'Providers',
  'Storage',
  'Proxy',
  'Debug',
];

const rows = ['Theme', 'Language', 'Claude Installation', 'Verbose Output'];

export const SettingsLoadingShell: React.FC = () => {
  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="mx-auto flex h-full max-w-6xl flex-col p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-heading-1">Settings</h1>
            <p className="mt-1 text-body-small text-muted-foreground">
              Loading configuration
            </p>
          </div>
          <div className="h-10 w-36 animate-pulse rounded-lg bg-muted" />
        </div>

        <div className="mt-8 flex max-w-full gap-1 overflow-hidden rounded-xl bg-muted/30 p-1">
          {tabs.map((tab, index) => (
            <div
              key={tab}
              className={[
                'h-10 flex-none rounded-lg px-3 text-sm font-medium leading-10',
                index === 0
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground',
              ].join(' ')}
            >
              {tab}
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-xl border border-border bg-card p-6">
          <div className="mb-6 h-8 w-48 animate-pulse rounded-md bg-muted" />
          <div className="space-y-6">
            {rows.map((row, index) => (
              <div key={row} className="flex items-center justify-between gap-8">
                <div>
                  <div className="text-base font-semibold text-foreground">{row}</div>
                  <div
                    className="mt-2 h-4 animate-pulse rounded bg-muted/70"
                    style={{ width: index % 2 === 0 ? 220 : 280 }}
                  />
                </div>
                <div
                  className="h-9 animate-pulse rounded-lg bg-muted"
                  style={{ width: index % 2 === 0 ? 180 : 120 }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsLoadingShell;
