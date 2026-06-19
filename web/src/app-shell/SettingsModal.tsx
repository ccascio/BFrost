import type { ReactNode } from 'react';
import { Icon } from '../icons';
import type { SettingsTab } from '../app-types';

const TABS: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'channels', label: 'Channels', icon: 'channels' },
  { id: 'workers', label: 'Workers', icon: 'workers' },
  { id: 'config', label: 'Config', icon: 'config' },
  { id: 'system', label: 'System', icon: 'system' },
  { id: 'actions', label: 'Actions', icon: 'actions' },
];

interface SettingsModalProps {
  isOpen: boolean;
  activeTab: SettingsTab;
  onSetTab: (tab: SettingsTab) => void;
  onClose: () => void;
  renderContent: (tab: SettingsTab) => ReactNode;
}

export function SettingsModal({ isOpen, activeTab, onSetTab, onClose, renderContent }: SettingsModalProps) {
  if (!isOpen) return null;
  return (
    <div
      className="settings-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-modal-header">
          <h2 className="settings-modal-title">Settings</h2>
          <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>
        <div className="settings-modal-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`settings-modal-tab${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => onSetTab(tab.id)}
            >
              <Icon name={tab.icon} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="settings-modal-body" role="tabpanel">
          {renderContent(activeTab)}
        </div>
      </div>
    </div>
  );
}
