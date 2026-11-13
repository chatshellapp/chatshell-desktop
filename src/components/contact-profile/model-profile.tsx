import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquarePlus, Settings2, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { ModelAvatar } from '@/components/model-avatar'
import { DeleteModelDialog } from '@/components/model-list-item/delete-dialog'
import { useModelStore } from '@/stores/modelStore'
import { useProviderSettingsStore } from '@/stores/providerSettingsStore'
import { useContactSelectionStore } from '@/stores/contactSelectionStore'
import { useSidebarHandlers } from '@/hooks/useSidebarHandlers'
import { useContactConversations } from '@/hooks/useContactProfile'
import { getModelLogo } from '@/lib/model-logos'
import type { Model } from '@/types'
import {
  DetailList,
  DetailHeader,
  DetailPage,
  DetailSection,
  RecentConversations,
} from '@/components/detail-page'

interface ModelProfileProps {
  model: Model
  onChatOpened: () => void
}

export function ModelProfile({ model, onChatOpened }: ModelProfileProps) {
  const { t } = useTranslation('sidebar')
  const { t: tCommon } = useTranslation('common')
  const { t: tProviders } = useTranslation('providers')
  const handlers = useSidebarHandlers()
  const provider = useModelStore((state) => state.getProviderById(model.provider_id))
  const openProviderSettings = useProviderSettingsStore((state) => state.openProviderSettings)
  const clearContact = useContactSelectionStore((state) => state.clearContact)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
  const { conversations, isLoading } = useContactConversations({ kind: 'model', id: model.id })

  const listItem = { id: model.id, name: model.name, modelId: model.model_id }

  return (
    <DetailPage>
      <DetailHeader
        avatar={
          <ModelAvatar
            logo={getModelLogo(model)}
            modelId={model.model_id}
            name={model.name}
            size="xl"
          />
        }
        name={model.name}
        subtitle={model.model_id}
        badges={provider && <Badge variant="secondary">{provider.name}</Badge>}
        isStarred={model.is_starred}
        primaryAction={{
          label: t('startChat'),
          icon: <MessageSquarePlus />,
          onClick: () => {
            void handlers.handleModelClick(listItem)
            onChatOpened()
          },
        }}
        onStarToggle={() => void handlers.handleModelStarToggle(listItem)}
        menuItems={
          <>
            <DropdownMenuItem onClick={() => openProviderSettings(model.provider_id)}>
              <Settings2 />
              {tCommon('configuration')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 />
              {tCommon('remove')}
            </DropdownMenuItem>
          </>
        }
      />

      <DetailSection title={t('contactDetails')}>
        <DetailList
          items={[
            { label: tCommon('name'), value: model.name },
            { label: tProviders('modelId'), value: model.model_id },
            { label: t('provider'), value: provider?.name },
            { label: tCommon('description'), value: model.description },
          ]}
        />
      </DetailSection>

      <DetailSection title={t('recentConversations')}>
        <RecentConversations
          conversations={conversations}
          isLoading={isLoading}
          onOpen={(id) => {
            void handlers.handleConversationClick(id)
            onChatOpened()
          }}
        />
      </DetailSection>

      <DeleteModelDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        modelName={model.name}
        onConfirm={() => {
          clearContact()
          void handlers.handleModelDelete(listItem)
        }}
      />
    </DetailPage>
  )
}
