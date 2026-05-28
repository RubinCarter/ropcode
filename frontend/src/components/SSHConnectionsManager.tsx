import React from 'react';
import { Button } from '@/components/ui/button';
import { api, SSHAuthMethod } from '@/lib/api';
import { useTranslation } from 'react-i18next';

interface SSHConnectionsManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export const SSHConnectionsManager: React.FC<SSHConnectionsManagerProps> = ({ isOpen, onClose, onChanged }) => {
  const { t } = useTranslation();
  const [list, setList] = React.useState<any[]>([]);
  const [editing, setEditing] = React.useState<any|null>(null);
  const [error, setError] = React.useState<string|null>(null);
  const [testing, setTesting] = React.useState(false);

  const load = async () => {
    try { setList(await api.listGlobalSshConnections()); } catch {}
  };
  React.useEffect(()=>{ if (isOpen) load(); }, [isOpen]);

  if (!isOpen) return null;

  const save = async () => {
    if (!editing) return;

    // Validate required fields
    if (!editing.name || !editing.host || !editing.username) {
      setError(t('ssh.nameHostUsernameRequired'));
      return;
    }

    if (editing.authType === 'password' && !editing.password) {
      setError(t('ssh.passwordRequired'));
      return;
    }

    if (editing.authType === 'privateKey' && !editing.keyPath) {
      setError(t('ssh.keyPathRequired'));
      return;
    }

    const authMethod: SSHAuthMethod = editing.authType==='password'
      ? { type:'password', password: editing.password||'' }
      : { type:'privateKey', keyPath: editing.keyPath||'~/.ssh/id_rsa', passphrase: editing.passphrase||undefined };

    try {
      await api.addGlobalSshConnection({
        name: editing.name,
        host: editing.host,
        port: Number(editing.port)||22,
        username: editing.username,
        auth_method: authMethod,
      });
      await load();
      setEditing(null);
      setError(null);
      onChanged?.();
    } catch (e: any) {
      setError(typeof e === 'string' ? e : (e?.message || t('ssh.failedToSave')));
    }
  };

  const del = async (name: string) => { await api.deleteGlobalSshConnection(name); await load(); onChanged?.(); };

  const test = async (item: any) => {
    setTesting(true); setError(null);
    try {
      // Use the authMethod directly from the saved connection
      await api.testSshConnection({
        host: item.host,
        port: item.port,
        username: item.username,
        authMethod: item.auth_method
      });
      setError(t('ssh.connectionSuccessful'));
    } catch (e:any) {
      setError(typeof e==='string'?e:(e?.message||t('ssh.connectionFailed')));
    } finally { setTesting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-background border rounded-lg shadow-lg w-full max-w-[720px] max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="text-lg font-semibold">{t('ssh.title')}</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={()=>setEditing({ name:'', host:'', port:22, username:'', authType:'privateKey'})}>{t('ssh.newConnection')}</Button>
            <Button size="sm" variant="outline" onClick={onClose}>{t('common.close')}</Button>
          </div>
        </div>
        <div className="flex-1 p-4 overflow-auto">
          {error && (<div className="mb-2 text-sm">{error}</div>)}
          {!editing ? (
            <div className="space-y-2">
              {list.map((item)=> (
                <div key={item.name} className="border rounded p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{item.name}</div>
                    <div className="text-xs text-muted-foreground">{item.username}@{item.host}:{item.port} · {item.auth_method?.type==='password'?'Password':'SSH Key'}</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={()=>test(item)} disabled={testing}>{t('ssh.testConnection')}</Button>
                  <Button size="sm" variant="outline" onClick={()=>setEditing({ ...item, authType: item.auth_method?.type==='password'?'password':'privateKey', password: item.auth_method?.password, keyPath: item.auth_method?.keyPath, passphrase: item.auth_method?.passphrase })}>{t('common.edit')}</Button>
                  <Button size="sm" variant="destructive" onClick={()=>del(item.name)}>{t('common.delete')}</Button>
                </div>
              ))}
              {list.length===0 && <div className="text-sm text-muted-foreground">{t('ssh.savedConnections')}</div>}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <input className="px-2 py-1.5 border rounded text-sm" placeholder={t('ssh.username')} value={editing.name} onChange={(e)=>setEditing({...editing, name:e.target.value})} />
                <input className="px-2 py-1.5 border rounded text-sm col-span-2" placeholder={t('ssh.host')} value={editing.host} onChange={(e)=>setEditing({...editing, host:e.target.value})} />
                <input className="px-2 py-1.5 border rounded text-sm" placeholder={t('ssh.port')} type="number" value={editing.port} onChange={(e)=>setEditing({...editing, port: parseInt(e.target.value)||22})} />
                <input className="px-2 py-1.5 border rounded text-sm col-span-2" placeholder={t('ssh.username')} value={editing.username} onChange={(e)=>setEditing({...editing, username:e.target.value})} />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={editing.authType==='password'} onChange={()=>setEditing({...editing, authType:'password'})} /> {t('ssh.password')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={editing.authType==='privateKey'} onChange={()=>setEditing({...editing, authType:'privateKey'})} /> {t('ssh.privateKey')}
                </label>
              </div>
              {editing.authType==='password' ? (
                <input className="w-full px-2 py-1.5 border rounded text-sm" type="password" placeholder={t('ssh.enterPassword')} value={editing.password||''} onChange={(e)=>setEditing({...editing, password:e.target.value})} />
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <input className="px-2 py-1.5 border rounded text-sm" placeholder={t('ssh.keyPath')} value={editing.keyPath||''} onChange={(e)=>setEditing({...editing, keyPath:e.target.value})} />
                  <input className="px-2 py-1.5 border rounded text-sm" type="password" placeholder={t('ssh.passphrase')} value={editing.passphrase||''} onChange={(e)=>setEditing({...editing, passphrase:e.target.value})} />
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={()=>setEditing(null)}>{t('common.cancel')}</Button>
                <Button size="sm" onClick={save}>{t('common.save')}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SSHConnectionsManager;

