import { createNotionPage } from '../notion/createPage.js'
import { saveTask } from '../redis/store.js'
import { getModalBlocks } from './modalBlocks.js'

const DESIGN_CHANNEL = process.env.DESIGN_CHANNEL_ID || 'C0ARG2KR5DX'

export function registerSubmissionHandlers(app) {
  function buildTaskModalView(taskType, taskTypeLabel, values = {}) {
    return {
      type: 'modal',
      callback_id: 'submit_task',
      private_metadata: JSON.stringify({ taskType, taskTypeLabel }),
      title: { type: 'plain_text', text: '📋 Бриф задачі' },
      submit: { type: 'plain_text', text: 'Створити задачу' },
      close: { type: 'plain_text', text: 'Скасувати' },
      blocks: getModalBlocks(taskType, values),
    }
  }

  // Крок 1 — юзер вибрав тип задачі, відкриваємо форму з полями
  app.view('select_task_type', async ({ ack, body, client, view }) => {
    const taskType = view.state.values.task_type_block.task_type.selected_option.value
    const taskTypeLabel = view.state.values.task_type_block.task_type.selected_option.text.text

    await ack({
      response_action: 'update',
      view: buildTaskModalView(taskType, taskTypeLabel),
    })
  })

  app.action('platform', async ({ ack, body, client }) => {
    await ack()

    const { taskType, taskTypeLabel } = JSON.parse(body.view.private_metadata)
    const values = {
      ...body.view.state.values,
      platform_block: {
        ...body.view.state.values.platform_block,
        platform: {
          ...body.actions[0],
          selected_option: body.actions[0].selected_option,
        },
      },
    }

    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: buildTaskModalView(taskType, taskTypeLabel, values),
    })
  })

  // Крок 2 — юзер заповнив бриф і натиснув "Створити задачу"
  app.view('submit_task', async ({ ack, body, client, view }) => {
    await ack()

    const { taskType, taskTypeLabel } = JSON.parse(view.private_metadata)
    const values = view.state.values
    const userId = body.user.id
    let notionCreated = false
    const userName = body.user.name

    // Базові поля
    const name = values.name_block?.name?.value
    const priority = values.priority_block?.priority?.selected_option?.value
    const deadline = values.deadline_block?.deadline?.selected_date
    const context = values.context_block?.context?.value
    const style = values.style_block?.style?.value
    const antiref = values.antiref_block?.antiref?.value
    const canEditText = values.can_edit_block?.can_edit?.selected_option?.value

    const specificFields = {}
    const artifacts = {}

    const videoFormat = values.video_format_block?.video_format?.selected_option?.value
    const printType = values.print_type_block?.print_type?.selected_option?.value
    const platform = values.platform_block?.platform?.selected_option?.value
    const platformOther = values.platform_other_block?.platform_other?.value

    const fieldMapping = {
      size_block: '📐 Розміри',
      print_size_block: '📐 Розмір і орієнтація',
      print_type_block: '🖨 Тип друкованого матеріалу',
      message_block: '💬 Ключове повідомлення',
      accent_block: '🎯 Основний акцент',
      color_model_block: '🎨 Кольорова модель',
      output_format_block: '📄 Формат файлу на виході',
      video_format_block: '🎬 Фінальний формат відео',
      subtitles_block: '💬 Субтитри',
      cta_block: '📢 CTA',
      mood_block: '🌀 Концепція / настрій',
      edit_style_block: '✂️ Стиль монтажу',
      slides_count_block: '🔢 Кількість слайдів',
      slides_text_block: '📝 Текст по слайдах',
      structure_block: '🗂 Структура',
      audience_block: '👥 Ціль і аудиторія',
      ai_description_block: '🤖 Що зобразити',
      new_blocks_block: '➕ Нові блоки',
      custom_images_block: '🖼 Кастомні картинки',
      carrier_block: '👕 Тип носія',
      print_zone_block: '📍 Зони нанесення',
      variants_block: '🔄 Кількість варіантів',
      concept_block: '💡 Концепція / меседж',
      restrictions_block: '🚫 Обмеження',
      brand_name_block: '🏷 Назва бренду',
      business_block: '🏢 Опис бізнесу',
      target_block: '🎯 ЦА',
      competitors_block: '⚔️ Конкуренти',
      usage_block: '📍 Де використовуватись',
      sphere_block: '🏭 Сфера',
      what_to_fix_block: '🔧 Що прибрати / змінити',
      person_name_block: '👤 Ім\'я та посада',
      event_date_block: '📅 Дата події',
      tv_text_block: '📺 Текст',
      qr_block: '🔗 QR / посилання',
      event_name_block: '🎪 Назва івенту',
      location_block: '📍 Локація',
      character_block: '🎭 Характер івенту',
      carriers_list_block: '📋 Перелік носіїв',
      slide_list_block: '📋 Перелік слайдів для правок',
      can_shorten_block: '✂️ Можна скорочувати текст',
      vacancy_block: '💼 Назва вакансії та умови',
      formats_list_block: '📐 Перелік форматів',
      promo_desc_block: '💡 Опис задачі',
      other_desc_block: '📝 Опис задачі',
    }

    for (const [blockId, label] of Object.entries(fieldMapping)) {
      const block = values[blockId]
      if (!block) continue
      const actionId = Object.keys(block)[0]
      const element = block[actionId]
      let val = element?.value || element?.selected_option?.value || element?.selected_date || null
      if (val) specificFields[label] = val
    }

    const artifactMapping = {
      artifact_figma_block: 'Figma / макет',
      artifact_drive_block: 'Google Drive',
      artifact_video_block: 'Відеоматеріал',
      artifact_music_block: 'Музика',
      artifact_photo_block: 'Фото',
      artifact_logo_block: 'Логотип',
      artifact_ref_block: 'Референси',
      artifact_brand_block: 'Бренд-гайд',
      artifact_pres_block: 'Презентація',
      artifact_article_block: 'Стаття / текст',
    }

    for (const [blockId, label] of Object.entries(artifactMapping)) {
      const block = values[blockId]
      if (!block) continue
      const actionId = Object.keys(block)[0]
      const val = block[actionId]?.value || null
      if (val) artifacts[label] = val
    }

    try {
      let slackPersonName = userName

      try {
        const userInfo = await client.users.info({ user: userId })
        const profile = userInfo.user?.profile

        slackPersonName =
          profile?.real_name ||
          profile?.display_name ||
          userInfo.user?.real_name ||
          userName ||
          userId
      } catch (slackUserErr) {
        console.error('Slack users.info failed, fallback to body.user.name:', slackUserErr)
      }

      const { pageId, pageUrl } = await createNotionPage({
        name: name || taskTypeLabel,
        priority,
        deadline,
        videoFormat,
        printType,
        platform,
        platformOther,
        taskType,
        context,
        style,
        antiref,
        canEditText,
        specificFields,
        artifacts,
        slackPersonName,
      })

      notionCreated = true

      try {
        await saveTask({
          pageId,
          slackUserId: userId,
          slackChannelId: userId,
          taskName: name || taskTypeLabel,
        })
      } catch (redisErr) {
        console.error('Redis saveTask failed (non-critical):', redisErr)
      }

      // Сповіщення замовнику
      await client.chat.postMessage({
        channel: userId,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Задача створена!*\n*${name || taskTypeLabel}*\nДизайн-команда отримала бриф і розпочне роботу.`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '📋 Відкрити в Notion' },
                url: pageUrl,
                style: 'primary',
              },
            ],
          },
        ],
      })

      // Сповіщення у канал дизайнерів
      await client.chat.postMessage({
        channel: DESIGN_CHANNEL,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🆕 *Нова задача від <@${userId}>*`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Задача:*\n${name || taskTypeLabel}` },
              { type: 'mrkdwn', text: `*Тип:*\n${taskTypeLabel}` },
              { type: 'mrkdwn', text: `*Пріоритет:*\n${priority || 'не вказано'}` },
              { type: 'mrkdwn', text: `*Дедлайн:*\n${deadline || 'не вказано'}` },
            ],
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '📋 Відкрити в Notion' },
                url: pageUrl,
                style: 'primary',
              },
            ],
          },
        ],
      })

    } catch (err) {
      console.error('Error creating task:', err)
      if (!notionCreated) {
        await client.chat.postMessage({
          channel: userId,
          text: '❌ Щось пішло не так при створенні задачі. Спробуй ще раз або звернись до адміна.',
        })
      }
    }
  })
}
