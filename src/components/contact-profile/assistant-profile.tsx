import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { AssistantAvatar } from '@/components/assistant-avatar'
import { AssistantDialog } from '@/components/assistant-dialog'
import { ModelAvatar } from '@/components/model-avatar'
import { DeleteAssistantDialog } from '@/components/assistant-list-item/delete-dialog'
import { useModelStore } from '@/stores/modelStore'
import { useSkillStore } from '@/stores/skillStore'
import { useContactSelectionStore } from '@/stores/contactSelectionStore'
import { useSidebarHandlers } from '@/hooks/useSidebarHandlers'
import { useContactConversations } from '@/hooks/useContactProfile'
import { getAssistantAvatarImage } from '@/lib/assistant-utils'
import { getModelLogo } from '@/lib/model-logos'
import type { Assistant } from '@/types'
import {
  CollapsibleText,
  DetailList,
  ProfileHeader,
  ProfilePage,
  ProfileSection,
  RecentConversations,
} from './profile-layout'

interface AssistantProfileProps {
  assistant: Assistant
  onChatOpened: () => void
}

export function AssistantProfile({ assistant, onChatOpened }: AssistantProfileProps) {
  const { t } = useTranslation('sidebar')
  const { t: tCommon } = useTranslation('common')
  const { t: tAssistants } = useTranslation('assistants')
  const handlers = useSidebarHandlers()
  const model = useModelStore((state) => state.getModelById(assistant.model_id))
  const skills = useSkillStore((state) => state.skills)
  const selectContact = useContactSelectionStore((state) => state.selectContact)
  const clearContact = useContactSelectionStore((state) => state.clearContact)
  const [showEditDialog, setShowEditDialog] = React.useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false)
  const { conversations, isLoading } = useContactConversations({
    kind: 'assistant',
    id: assistant.id,
  })

  const listItem = { id: assistant.id, name: assistant.name }
  const groupName = assistant.group_name || t('ungrouped')

  const skillNames = React.useMemo(() => {
    const byId = new Map(skills.map((skill) => [skill.id, skill.name]))
    return assistant.skill_ids.map((id) => byId.get(id)).filter((name): name is string => !!name)
  }, [skills, assistant.skill_ids])

  const handleDuplicate = async () => {
    const copy = await handlers.handleAssistantDuplicate(
      listItem,
      t('assistantCopyName', { name: assistant.name })
    )
    if (copy) selectContact({ kind: 'assistant', id: copy.id })
  }

  return (
    <ProfilePage>
      <ProfileHeader
        avatar={
          <AssistantAvatar
            logo={getAssistantAvatarImage(assistant)}
            avatarBg={assistant.avatar_bg || '#3b82f6'}
            avatarText={assistant.avatar_text || assistant.name.charAt(0)}
            name={assistant.name}
            size="xl"
          />
        }
        name={assistant.name}
        subtitle={assistant.role}
        badges={<Badge variant="secondary">{groupName}</Badge>}
        isStarred={assistant.is_starred}
        onStartChat={() => {
          void handlers.handleAssistantClick(listItem)
          onChatOpened()
        }}
        onStarToggle={() => void handlers.handleAssistantStarToggle(listItem)}
        menuItems={
          <>
            <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
              <Pencil />
              {tCommon('edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handleDuplicate()}>
              <Copy />
              {t('duplicate')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 />
              {tCommon('delete')}
            </DropdownMenuItem>
          </>
        }
      />

      <ProfileSection title={t('contactDetails')}>
        <DetailList
          items={[
            { label: tCommon('description'), value: assistant.description },
            {
              label: tAssistants('model'),
              value: model ? (
                <span className="inline-flex items-center gap-2">
                  <ModelAvatar
                    logo={getModelLogo(model)}
                    modelId={model.model_id}
                    name={model.name}
                    size="xs"
                  />
                  {model.name}
                </span>
              ) : (
                <span className="text-muted-foreground">{t('modelUnavailable')}</span>
              ),
            },
            {
              label: t('parameterPreset'),
              value: assistant.preset?.name ?? t('defaultPreset'),
            },
            {
              label: tAssistants('tools'),
              value:
                assistant.tool_ids.length > 0 ? assistant.tool_ids.length : tAssistants('none'),
            },
            {
              label: tCommon('skills'),
              value:
                skillNames.length > 0
                  ? skillNames.join(', ')
                  : assistant.skill_ids.length > 0
                    ? assistant.skill_ids.length
                    : tAssistants('none'),
            },
          ]}
        />
      </ProfileSection>

      {assistant.system_prompt.trim() && (
        <ProfileSection title={tAssistants('systemPrompt')}>
          <CollapsibleText text={assistant.system_prompt} />
        </ProfileSection>
      )}

      {assistant.user_prompt?.trim() && (
        <ProfileSection title={t('userPrompt')}>
          <CollapsibleText text={assistant.user_prompt} />
        </ProfileSection>
      )}

      <ProfileSection title={t('recentConversations')}>
        <RecentConversations
          conversations={conversations}
          isLoading={isLoading}
          onOpen={(id) => {
            void handlers.handleConversationClick(id)
            onChatOpened()
          }}
        />
      </ProfileSection>

      <AssistantDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        assistant={assistant}
        mode="edit"
      />

      <DeleteAssistantDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        assistantName={assistant.name}
        onConfirm={() => {
          clearContact()
          void handlers.handleAssistantDelete(listItem)
        }}
      />
    </ProfilePage>
  )
}
