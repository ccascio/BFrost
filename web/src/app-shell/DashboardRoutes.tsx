import type { DashboardTab, SettingsTab } from '../app-types';
import { renderWorkerDashboardView } from '../app-helpers';
import { SettingsModal } from './SettingsModal';
import { ActionsTab } from '../tabs/ActionsTab';
import { HealthTab } from '../tabs/HealthTab';
import { StoreTab } from '../tabs/StoreTab';
import { ChannelsTab } from '../tabs/ChannelsTab';
import { ChatTab } from '../tabs/ChatTab';
import { WorkersTab } from '../tabs/WorkersTab';
import { SystemTab } from '../tabs/SystemTab';
import { OverviewTab } from '../tabs/OverviewTab';
import { JobsTab } from '../tabs/JobsTab';
import { ConfigTab } from '../tabs/ConfigTab';
import { JobOperationsPanel } from '../tabs/JobOperationsPanel';
import { PlatformRoutingPanel, PlatformSecurityPanel } from '../tabs/PlatformConfigPanels';
import { WorkerConfigPage } from '../tabs/WorkerConfigPage';
import type { SettingsWorkerEntry } from '../tabs/ConfigTab';
import { OperationalRoutes } from './OperationalRoutes';

export function DashboardRoutes(props: any) {
  const {
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    setSettingsTab,
    activeTab,
    activeWorkerTab,
    dashboard,
    busyKey,
    setBusyKey,
    setError,
    setDashboard,
    setActiveTab,
    overview,
    fetchDashboard,
    setWizardOpen,
    wizardCompleted,
    chat,
    renderStuckDetectorBanner,
    dashboardViews,
    workerViewContext,
    selectedModelAlias,
    setSelectedModelAlias,
    saveDefaultModel,
    setNotice,
    expandedChannelId,
    setExpandedChannelId,
    jobsByWorker,
    selectedJob,
    selectedJobRuns,
    setSelectedJobName,
    jobDrafts,
    setJobDrafts,
    confirmSaveJobName,
    setConfirmSaveJobName,
    openPromptEditors,
    setOpenPromptEditors,
    customListItemDrafts,
    setCustomListItemDrafts,
    mutate,
    triggerRun,
    configCoreCount,
    selectedCoreConfigKey,
    setSelectedCoreConfigKey,
    activeLocalProviderDraft,
    setActiveLocalProviderDraft,
    primaryChannelDraft,
    setPrimaryChannelDraft,
    savePlatformRouting,
    adminPasswordDraft,
    setAdminPasswordDraft,
    sessionTtlDraft,
    setSessionTtlDraft,
    jobTimeoutDraft,
    setJobTimeoutDraft,
    saveCoreSettings,
    configGroupsByWorker,
    surfaceDrafts,
    setSurfaceDrafts,
    saveWorkerConfigurationSurface,
    extraSettingsTabs,
    operations,
    store,
  } = props;

  // Persists a per-job model override; empty alias falls back to the platform default.
  // An empty reasoningLevel likewise falls back to the platform default level.
  function saveJobModel(job: any, modelAlias: string, reasoningLevel?: string) {
    return mutate(
      `job-model-${job.name}`,
      `/api/cron-jobs/${encodeURIComponent(job.name)}`,
      {
        method: 'POST',
        body: JSON.stringify(
          reasoningLevel === undefined ? { modelAlias } : { modelAlias, reasoningLevel },
        ),
      },
      `${job.label} model updated.`,
    );
  }

  return (
    <>
      {activeTab === 'overview' ? (
        <OverviewTab
          dashboard={dashboard}
          busyKey={busyKey}
          setBusyKey={setBusyKey}
          setError={setError}
          setDashboard={setDashboard}
          setActiveTab={setActiveTab}
          runDemoAction={overview.runDemoAction}
          fetchDashboard={fetchDashboard}
          firstResultJob={overview.firstResultJob}
          firstResultShownKey={overview.firstResultShownKey}
          setFirstResultJob={overview.setFirstResultJob}
          lmAdoptDismissed={overview.lmAdoptDismissed}
          setLmAdoptDismissed={overview.setLmAdoptDismissed}
          lmAdopting={overview.lmAdopting}
          setLmAdopting={overview.setLmAdopting}
          setWizardOpen={setWizardOpen}
          onboardingRan={overview.onboardingRan}
          demoNarration={overview.demoNarration}
          demoRecap={overview.demoRecap}
          setDemoRecap={overview.setDemoRecap}
          starAsk={overview.starAsk}
          dismissStarAsk={overview.dismissStarAsk}
          wizardCompleted={wizardCompleted}
          cloudTestReply={overview.cloudTestReply}
          setCloudTestReply={overview.setCloudTestReply}
          cloudConnectProvider={overview.cloudConnectProvider}
          setCloudConnectProvider={overview.setCloudConnectProvider}
          cloudConnectKey={overview.cloudConnectKey}
          setCloudConnectKey={overview.setCloudConnectKey}
          cloudConnecting={overview.cloudConnecting}
          setCloudConnecting={overview.setCloudConnecting}
          recipeApplied={overview.recipeApplied}
          setRecipeApplied={overview.setRecipeApplied}
          recipeExpanded={overview.recipeExpanded}
          setRecipeExpanded={overview.setRecipeExpanded}
          recipeInputValues={overview.recipeInputValues}
          setRecipeInputValues={overview.setRecipeInputValues}
          recipeApplying={overview.recipeApplying}
          setRecipeApplying={overview.setRecipeApplying}
          openChatFromOverview={chat.openChatFromOverview}
          renderStuckDetectorBanner={renderStuckDetectorBanner}
          dashboardViews={dashboardViews}
          workerViewContext={workerViewContext}
          selectedModelAlias={selectedModelAlias}
          setSelectedModelAlias={setSelectedModelAlias}
          saveDefaultModel={saveDefaultModel}
          setNotice={setNotice}
        />
      ) : null}

      {activeTab === 'chat' ? (
        <ChatTab
          dashboard={dashboard}
          dashboardViews={dashboardViews}
          busyKey={busyKey}
          chatDraft={chat.chatDraft}
          setChatDraft={chat.setChatDraft}
          chatTurns={chat.chatTurns}
          chatThreads={chat.chatThreads}
          chatProjects={chat.chatProjects}
          activeProjectId={chat.activeProjectId}
          setActiveProjectId={chat.setActiveProjectId}
          activeConversationId={chat.activeConversationId}
          chatArrivingFromOverview={chat.chatArrivingFromOverview}
          chatModelAlias={chat.chatModelAlias}
          setChatModelAlias={chat.setChatModelAlias}
          chatReasoningLevel={chat.chatReasoningLevel}
          setChatReasoningLevel={chat.setChatReasoningLevel}
          chatQuery={chat.chatQuery}
          setChatQuery={chat.setChatQuery}
          projectComboOpen={chat.projectComboOpen}
          setProjectComboOpen={chat.setProjectComboOpen}
          projectComboQuery={chat.projectComboQuery}
          setProjectComboQuery={chat.setProjectComboQuery}
          projectComboRef={chat.projectComboRef}
          chatLogRef={chat.chatLogRef}
          chatInputRef={chat.chatInputRef}
          createChatProject={chat.createChatProject}
          renameChatProject={chat.renameChatProject}
          startNewChat={chat.startNewChat}
          openChatThread={chat.openChatThread}
          renameChatThread={chat.renameChatThread}
          deleteChatThread={chat.deleteChatThread}
          sendDashboardChat={chat.sendDashboardChat}
          fillChatDraft={chat.fillChatDraft}
          artifacts={chat.artifacts}
          artifactPanelOpen={chat.artifactPanelOpen}
          setArtifactPanelOpen={chat.setArtifactPanelOpen}
          artifactPanelPinned={chat.artifactPanelPinned}
          setArtifactPanelPinned={chat.setArtifactPanelPinned}
          activeArtifactId={chat.activeArtifactId}
          setActiveArtifactId={chat.setActiveArtifactId}
          openArtifact={chat.openArtifact}
          deleteArtifactFromConversation={chat.deleteArtifactFromConversation}
        />
      ) : null}

      <OperationalRoutes {...props} />

      <SettingsModal
        isOpen={settingsOpen}
        activeTab={settingsTab as SettingsTab}
        onSetTab={(tab) => setSettingsTab(tab)}
        onClose={() => setSettingsOpen(false)}
        extraTabs={extraSettingsTabs}
        renderContent={(tab) => {
          if ((tab as string).startsWith('worker-settings:')) {
            const workerId = (tab as string).slice('worker-settings:'.length);
            const group = (configGroupsByWorker as any[]).find((g: any) => g.worker.id === workerId);
            if (!group) return null;
            return (
              <WorkerConfigPage
                worker={group.worker}
                surfaces={group.surfaces}
                dashboard={dashboard}
                dashboardViews={dashboardViews}
                surfaceDrafts={surfaceDrafts}
                setSurfaceDrafts={setSurfaceDrafts}
                customListItemDrafts={customListItemDrafts}
                setCustomListItemDrafts={setCustomListItemDrafts}
                busyKey={busyKey}
                fetchDashboard={fetchDashboard}
                saveWorkerConfigurationSurface={saveWorkerConfigurationSurface}
                saveJobModel={saveJobModel}
              />
            );
          }
          if (tab === 'channels') return (
            <ChannelsTab
              dashboard={dashboard}
              expandedChannelId={expandedChannelId}
              setExpandedChannelId={setExpandedChannelId}
              dashboardViews={dashboardViews}
              fetchDashboard={fetchDashboard}
            />
          );
          if (tab === 'workers') return (
            <WorkersTab
              dashboard={dashboard}
              busyKey={busyKey}
              workerDescription={operations.workers.workerDescription}
              setWorkerDescription={operations.workers.setWorkerDescription}
              generatedWorker={operations.workers.generatedWorker}
              workerUploadFile={operations.workers.workerUploadFile}
              setWorkerUploadFile={operations.workers.setWorkerUploadFile}
              storeUpdates={store.storeUpdates}
              generateWorkerFromDescription={operations.workers.generateWorkerFromDescription}
              uploadWorkerZip={operations.workers.uploadWorkerZip}
              deleteWorker={operations.workers.deleteWorker}
              mutate={mutate}
            />
          );
          if (tab === 'config') {
            const settingsWorkerEntries: SettingsWorkerEntry[] = (configGroupsByWorker as any[])
              .filter((g: any) => g.worker.settingsOnly && g.worker.kind !== 'provider')
              .map((group: any) => ({
                worker: group.worker,
                configPanel: (
                  <WorkerConfigPage
                    worker={group.worker}
                    surfaces={group.surfaces}
                    dashboard={dashboard}
                    dashboardViews={dashboardViews}
                    surfaceDrafts={surfaceDrafts}
                    setSurfaceDrafts={setSurfaceDrafts}
                    customListItemDrafts={customListItemDrafts}
                    setCustomListItemDrafts={setCustomListItemDrafts}
                    busyKey={busyKey}
                    fetchDashboard={fetchDashboard}
                    saveWorkerConfigurationSurface={saveWorkerConfigurationSurface}
                    saveJobModel={saveJobModel}
                  />
                ),
              }));
            return (
              <ConfigTab
                dashboard={dashboard}
                configCoreCount={configCoreCount}
                selectedCoreConfigKey={selectedCoreConfigKey}
                setSelectedCoreConfigKey={setSelectedCoreConfigKey}
                dashboardViews={dashboardViews}
                workerViewContext={workerViewContext}
                platformRoutingPanel={
                  <PlatformRoutingPanel
                    dashboard={dashboard}
                    busyKey={busyKey}
                    activeLocalProviderDraft={activeLocalProviderDraft}
                    setActiveLocalProviderDraft={setActiveLocalProviderDraft}
                    primaryChannelDraft={primaryChannelDraft}
                    setPrimaryChannelDraft={setPrimaryChannelDraft}
                    savePlatformRouting={savePlatformRouting}
                  />
                }
                platformSecurityPanel={
                  <PlatformSecurityPanel
                    dashboard={dashboard}
                    busyKey={busyKey}
                    adminPasswordDraft={adminPasswordDraft}
                    setAdminPasswordDraft={setAdminPasswordDraft}
                    sessionTtlDraft={sessionTtlDraft}
                    setSessionTtlDraft={setSessionTtlDraft}
                    jobTimeoutDraft={jobTimeoutDraft}
                    setJobTimeoutDraft={setJobTimeoutDraft}
                    saveCoreSettings={saveCoreSettings}
                  />
                }
                setActiveTab={setActiveTab}
                setWizardOpen={setWizardOpen}
                settingsWorkerEntries={settingsWorkerEntries}
              />
            );
          }
          if (tab === 'system') return (
            <SystemTab
              dashboard={dashboard}
              whatsNew={operations.system.whatsNew}
              autoBackupSettings={operations.system.autoBackupSettings}
              setAutoBackupSettings={operations.system.setAutoBackupSettings}
              saveAutoBackup={operations.system.saveAutoBackup}
              busyKey={busyKey}
              mutate={mutate}
              restoreBackup={operations.system.restoreBackup}
              cancelRestore={operations.system.cancelRestore}
              resetChecks={operations.system.resetChecks}
              setResetChecks={operations.system.setResetChecks}
              resetConfirmOpen={operations.system.resetConfirmOpen}
              setResetConfirmOpen={operations.system.setResetConfirmOpen}
              executeFactoryReset={operations.system.executeFactoryReset}
              setActiveTab={operations.system.setActiveTab}
            />
          );
          if (tab === 'jobs') return (
            <JobsTab
              dashboard={dashboard}
              jobsByWorker={jobsByWorker}
              selectedJob={selectedJob}
              selectedJobRuns={selectedJobRuns}
              setSelectedJobName={setSelectedJobName}
              renderJobOperations={(job, runs) => (
                <JobOperationsPanel
                  dashboard={dashboard}
                  job={job}
                  runs={runs}
                  busyKey={busyKey}
                  jobDrafts={jobDrafts}
                  setJobDrafts={setJobDrafts}
                  confirmSaveJobName={confirmSaveJobName}
                  setConfirmSaveJobName={setConfirmSaveJobName}
                  openPromptEditors={openPromptEditors}
                  setOpenPromptEditors={setOpenPromptEditors}
                  customListItemDrafts={customListItemDrafts}
                  setCustomListItemDrafts={setCustomListItemDrafts}
                  mutate={mutate}
                  triggerRun={triggerRun}
                />
              )}
            />
          );
          if (tab === 'store') return (
            <StoreTab
              dashboard={dashboard}
              storeWorkers={store.storeWorkers}
              storeLoading={store.storeLoading}
              storeError={store.storeError}
              storeQuery={store.storeQuery}
              setStoreQuery={store.setStoreQuery}
              storeQueryInput={store.storeQueryInput}
              setStoreQueryInput={store.setStoreQueryInput}
              storeCategoryFilter={store.storeCategoryFilter}
              setStoreCategoryFilter={store.setStoreCategoryFilter}
              storeSelectedId={store.storeSelectedId}
              setStoreSelectedId={store.setStoreSelectedId}
              storeDetail={store.storeDetail}
              setStoreDetail={store.setStoreDetail}
              storeDetailLoading={store.storeDetailLoading}
              sideloadFile={store.sideloadFile}
              setSideloadFile={store.setSideloadFile}
              setConsentTarget={store.setConsentTarget}
              busyKey={busyKey}
              fetchStoreCatalog={store.fetchStoreCatalog}
              fetchStoreDetail={store.fetchStoreDetail}
              installFromStore={store.installFromStore}
              sideloadWorkerZip={store.sideloadWorkerZip}
              mutate={store.mutate}
            />
          );
          if (tab === 'health') return (
            <HealthTab
              jobMetrics={operations.health.jobMetrics}
              jobMetricsLoading={operations.health.jobMetricsLoading}
              jobMetricsError={operations.health.jobMetricsError}
              fetchJobMetrics={operations.health.fetchJobMetrics}
              expandedWorkerIds={operations.health.expandedWorkerIds}
              setExpandedWorkerIds={operations.health.setExpandedWorkerIds}
              setActiveTab={operations.health.setActiveTab}
            />
          );
          if (tab === 'actions') return (
            <ActionsTab
              pendingActions={operations.actions.pendingActions}
              actionHistory={operations.actions.actionHistory}
              actionsLoading={operations.actions.actionsLoading}
              selectedActionId={operations.actions.selectedActionId}
              setSelectedActionId={operations.actions.setSelectedActionId}
              busyKey={busyKey}
              decideAction={operations.actions.decideAction}
              fetchPendingActions={operations.actions.fetchPendingActions}
            />
          );
          return null;
        }}
      />

      {activeWorkerTab ? renderWorkerDashboardView(activeWorkerTab, workerViewContext) : null}

      {activeTab.startsWith('worker-config:') ? (
        <WorkerConfigRoute
          activeTab={activeTab}
          configGroupsByWorker={configGroupsByWorker}
          saveJobModel={saveJobModel}
          dashboard={dashboard}
          dashboardViews={dashboardViews}
          surfaceDrafts={surfaceDrafts}
          setSurfaceDrafts={setSurfaceDrafts}
          customListItemDrafts={customListItemDrafts}
          setCustomListItemDrafts={setCustomListItemDrafts}
          busyKey={busyKey}
          fetchDashboard={fetchDashboard}
          saveWorkerConfigurationSurface={saveWorkerConfigurationSurface}
        />
      ) : null}


    </>
  );
}

// Deliberately settings-only: job schedules, params, and run history live in the
// Jobs page. Duplicating the schedule editor here made the same cron editable from
// two places at once.
function WorkerConfigRoute(props: {
  activeTab: DashboardTab;
  configGroupsByWorker: any[];
  saveJobModel: (job: any, modelAlias: string, reasoningLevel?: string) => Promise<void>;
  dashboard: any;
  dashboardViews: any;
  surfaceDrafts: any;
  setSurfaceDrafts: any;
  customListItemDrafts: any;
  setCustomListItemDrafts: any;
  busyKey: string | null;
  fetchDashboard: any;
  saveWorkerConfigurationSurface: any;
}) {
  const workerId = props.activeTab.slice('worker-config:'.length);
  // Workers without manifest config surfaces still get a Config page when they own
  // jobs — the page then shows only the generic per-job model panel.
  const group =
    props.configGroupsByWorker.find((entry) => entry.worker.id === workerId) ??
    (props.dashboard.cron.jobs.some((job: any) => job.workerId === workerId)
      ? {
          worker: props.dashboard.workers.find((worker: any) => worker.id === workerId),
          surfaces: [],
        }
      : null);
  if (!group?.worker) return null;

  return (
    <WorkerConfigPage
      worker={group.worker}
      surfaces={group.surfaces}
      saveJobModel={props.saveJobModel}
      dashboard={props.dashboard}
      dashboardViews={props.dashboardViews}
      surfaceDrafts={props.surfaceDrafts}
      setSurfaceDrafts={props.setSurfaceDrafts}
      customListItemDrafts={props.customListItemDrafts}
      setCustomListItemDrafts={props.setCustomListItemDrafts}
      busyKey={props.busyKey}
      fetchDashboard={props.fetchDashboard}
      saveWorkerConfigurationSurface={props.saveWorkerConfigurationSurface}
    />
  );
}
