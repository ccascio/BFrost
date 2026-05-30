import { useState } from 'react';
import { Button, IconButton } from './Button';
import { CodeTabs } from './CodeTabs';
import { CopyButton } from './CopyButton';
import { AlertDialog, Dialog } from './Dialog';
import { ManagementBar } from './ManagementBar';
import { NotificationStack } from './NotificationStack';
import { Progress } from './Progress';
import { Sheet } from './Sheet';
import { Tooltip } from './Tooltip';

export function UiDemo() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notifications, setNotifications] = useState([
    { id: 'demo-ready', tone: 'success' as const, title: 'UI primitives ready', description: 'This stack is keyboard-dismissable and motion-aware.' },
  ]);

  return (
    <main className="ui-demo-shell">
      <section className="panel">
        <p className="panel-kicker">Internal</p>
        <h1>BFrost UI primitives</h1>
        <p className="hero-copy">
          A small composition surface for Phase A0. Open with <code>?ui-demo=1</code>.
        </p>
      </section>

      <section className="panel ui-demo-grid">
        <div className="ui-demo-block">
          <h2>Buttons and tooltip</h2>
          <div className="panel-actions wrap">
            <Button variant="primary" onClick={() => setDialogOpen(true)}>Open dialog</Button>
            <Button onClick={() => setSheetOpen(true)}>Open sheet</Button>
            <Button variant="danger" onClick={() => setAlertOpen(true)}>Open alert</Button>
            <Tooltip content="Icon buttons require an accessible label.">
              <IconButton label="Demo icon">?</IconButton>
            </Tooltip>
            <CopyButton value="npm run build:web" />
          </div>
        </div>

        <div className="ui-demo-block">
          <h2>Progress</h2>
          <Progress value={64} label="Worker install" />
          <Progress value={null} label="Waiting for runtime" tone="warning" />
        </div>

        <div className="ui-demo-block">
          <h2>Management bar</h2>
          <ManagementBar
            label="Queue items"
            selectedCount={2}
            totalCount={18}
            filters={<Button size="sm">Queued</Button>}
            actions={<><Button size="sm" variant="primary">Approve</Button><Button size="sm">Reject</Button></>}
            pagination={<span className="footnote">Page 1 of 3</span>}
          />
        </div>

        <div className="ui-demo-block">
          <h2>Code tabs</h2>
          <CodeTabs
            tabs={[
              { id: 'build', label: 'Build', language: 'bash', code: 'npm run build' },
              { id: 'dev', label: 'Dev', language: 'bash', code: 'npm run dev' },
            ]}
          />
        </div>
      </section>

      <NotificationStack
        items={notifications}
        onDismiss={(id) => setNotifications((current) => current.filter((item) => item.id !== id))}
      />

      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="Generic dialog"
        description="Focus moves inside and Escape closes it."
        footer={<Button variant="primary" onClick={() => setDialogOpen(false)}>Done</Button>}
      >
        <p>Use this for focused setup, install consent, and review flows.</p>
      </Dialog>

      <AlertDialog
        open={alertOpen}
        onOpenChange={setAlertOpen}
        title="Confirm risky action"
        description="Alert dialogs should be reserved for destructive or high-risk actions."
        footer={<><Button onClick={() => setAlertOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => setAlertOpen(false)}>Confirm</Button></>}
      >
        <p>This primitive uses <code>role="alertdialog"</code>.</p>
      </AlertDialog>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Detail sheet"
        description="Use sheets for side details without replacing the whole view."
        footer={<Button variant="primary" onClick={() => setSheetOpen(false)}>Close sheet</Button>}
      >
        <p>Good candidates: worker detail, action diff, queue item metadata, and install stages.</p>
      </Sheet>
    </main>
  );
}
