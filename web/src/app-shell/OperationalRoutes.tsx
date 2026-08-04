import { ActionsTab } from '../tabs/ActionsTab';
import { ChannelsTab } from '../tabs/ChannelsTab';
import { HealthTab } from '../tabs/HealthTab';
import { JobOperationsPanel } from '../tabs/JobOperationsPanel';
import { JobsTab } from '../tabs/JobsTab';
import { StoreTab } from '../tabs/StoreTab';
import { SystemTab } from '../tabs/SystemTab';
import { WorkersTab } from '../tabs/WorkersTab';

/** Full-page operational views selected from the sidebar. */
export function OperationalRoutes(props: any) {
  const {
    activeTab, dashboard, busyKey, expandedChannelId, setExpandedChannelId,
    dashboardViews, fetchDashboard, operations, store, mutate, jobsByWorker,
    selectedJob, selectedJobRuns, setSelectedJobName, jobDrafts, setJobDrafts,
    confirmSaveJobName, setConfirmSaveJobName, openPromptEditors,
    setOpenPromptEditors, customListItemDrafts, setCustomListItemDrafts, triggerRun,
  } = props;

  if (activeTab === 'channels') return (
    <ChannelsTab dashboard={dashboard} expandedChannelId={expandedChannelId}
      setExpandedChannelId={setExpandedChannelId} dashboardViews={dashboardViews}
      fetchDashboard={fetchDashboard} />
  );
  if (activeTab === 'workers') return (
    <WorkersTab dashboard={dashboard} busyKey={busyKey}
      workerDescription={operations.workers.workerDescription}
      setWorkerDescription={operations.workers.setWorkerDescription}
      generatedWorker={operations.workers.generatedWorker}
      workerUploadFile={operations.workers.workerUploadFile}
      setWorkerUploadFile={operations.workers.setWorkerUploadFile}
      storeUpdates={store.storeUpdates}
      generateWorkerFromDescription={operations.workers.generateWorkerFromDescription}
      uploadWorkerZip={operations.workers.uploadWorkerZip}
      deleteWorker={operations.workers.deleteWorker} mutate={mutate} />
  );
  if (activeTab === 'jobs') return (
    <JobsTab dashboard={dashboard} jobsByWorker={jobsByWorker} selectedJob={selectedJob}
      selectedJobRuns={selectedJobRuns} setSelectedJobName={setSelectedJobName}
      renderJobOperations={(job, runs) => (
        <JobOperationsPanel dashboard={dashboard} job={job} runs={runs} busyKey={busyKey}
          jobDrafts={jobDrafts} setJobDrafts={setJobDrafts}
          confirmSaveJobName={confirmSaveJobName} setConfirmSaveJobName={setConfirmSaveJobName}
          openPromptEditors={openPromptEditors} setOpenPromptEditors={setOpenPromptEditors}
          customListItemDrafts={customListItemDrafts} setCustomListItemDrafts={setCustomListItemDrafts}
          mutate={mutate} triggerRun={triggerRun} />
      )} />
  );
  if (activeTab === 'store') return (
    <StoreTab dashboard={dashboard} storeWorkers={store.storeWorkers}
      storeLoading={store.storeLoading} storeError={store.storeError}
      storeQuery={store.storeQuery} setStoreQuery={store.setStoreQuery}
      storeQueryInput={store.storeQueryInput} setStoreQueryInput={store.setStoreQueryInput}
      storeCategoryFilter={store.storeCategoryFilter} setStoreCategoryFilter={store.setStoreCategoryFilter}
      storeSelectedId={store.storeSelectedId} setStoreSelectedId={store.setStoreSelectedId}
      storeDetail={store.storeDetail} setStoreDetail={store.setStoreDetail}
      storeDetailLoading={store.storeDetailLoading} sideloadFile={store.sideloadFile}
      setSideloadFile={store.setSideloadFile} setConsentTarget={store.setConsentTarget}
      busyKey={busyKey} fetchStoreCatalog={store.fetchStoreCatalog}
      fetchStoreDetail={store.fetchStoreDetail} installFromStore={store.installFromStore}
      sideloadWorkerZip={store.sideloadWorkerZip} mutate={store.mutate} />
  );
  if (activeTab === 'health') return (
    <HealthTab jobMetrics={operations.health.jobMetrics}
      jobMetricsLoading={operations.health.jobMetricsLoading}
      jobMetricsError={operations.health.jobMetricsError}
      fetchJobMetrics={operations.health.fetchJobMetrics}
      expandedWorkerIds={operations.health.expandedWorkerIds}
      setExpandedWorkerIds={operations.health.setExpandedWorkerIds}
      setActiveTab={operations.health.setActiveTab} />
  );
  if (activeTab === 'actions') return (
    <ActionsTab pendingActions={operations.actions.pendingActions}
      actionHistory={operations.actions.actionHistory} actionsLoading={operations.actions.actionsLoading}
      selectedActionId={operations.actions.selectedActionId}
      setSelectedActionId={operations.actions.setSelectedActionId} busyKey={busyKey}
      decideAction={operations.actions.decideAction}
      fetchPendingActions={operations.actions.fetchPendingActions} />
  );
  if (activeTab === 'system') return (
    <SystemTab dashboard={dashboard} whatsNew={operations.system.whatsNew}
      autoBackupSettings={operations.system.autoBackupSettings}
      setAutoBackupSettings={operations.system.setAutoBackupSettings}
      saveAutoBackup={operations.system.saveAutoBackup} busyKey={busyKey} mutate={mutate}
      restoreBackup={operations.system.restoreBackup} cancelRestore={operations.system.cancelRestore}
      resetChecks={operations.system.resetChecks} setResetChecks={operations.system.setResetChecks}
      resetConfirmOpen={operations.system.resetConfirmOpen}
      setResetConfirmOpen={operations.system.setResetConfirmOpen}
      executeFactoryReset={operations.system.executeFactoryReset}
      setActiveTab={operations.system.setActiveTab} />
  );
  return null;
}
