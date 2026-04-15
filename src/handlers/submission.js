import { createNotionPage } from '../notion/createPage.js'
import { saveTask } from '../redis/store.js'
import { getModalBlocks } from './modalBlocks.js'

export function registerSubmissionHandlers(app) {

  // Крок 1 — юзер вибрав тип задачі, відкриваємо форму з полями
  app.view('select_task_type', async ({ ack, body, client, view }) => {
    const taskType = view.state.values.task_type_block.task_type.selected_option.value
    const taskTypeLabel = view.state.values.task_type_block.task_type.selected_option.text.text

    await ack({
      response_action: 'push',
      view: {
        type: 'modal',
        callback_id: 'submit_task',
        private_metadata: JSON.stringify({ taskType, taskTypeLabel }),
        title: { type: 'plain_text', text: '📋 Бриф задачі' },
        submit: { type: 'plain_text', text: 'Створити задачу' },
        close: { type: 'plain_text', text: '← Назад' },
        blocks: getModalBlocks(taskType),
      },
    })
  })

  // Крок 2 — юзер заповнив бриф і натиснув "Створити задачу"
  app.view('submit_task', async ({ ack, body, client, view }) => {
    await ack()

    const { taskType, taskTypeLabel } = JSON.parse(view.private_metadata)
    const values = view.state.values
    const userId = body.user.id

    // Базові поля
    const name = values.name_block?.name?.value
    const priority = values.priority_block?.priority?.selected_option?.value
    const deadline = values.deadline_block?.deadline?.selected_date
    const context = values.context_block?.context?.value
    const style = values.style_block?.style?.value
    const antiref = values.antiref_block?.antiref?.value
    const canEditText = values.can_edit_block?.can_edit?.selected_option?.value

    // Специфічні поля — збираємо все що є
    const specificFields = {}
    const artifacts = {}

    // Формат і платформа → йдуть в properties Notion
    const format = values.format_block?.format?.selected_option?.value
    const platform = values.platform_block?.platform?.selected_option?.value

    // Всі інші специфічні поля → в Description
    const fieldMapping = {
      size_block: '📐 Розміри',
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
    }

    for (const [blockId, label] of Object.entries(fieldMapping)) {
      const block = values[blockId]
      if (!block) continue
      const actionId = Object.keys(block)[0]
      const element = block[actionId]
      let val = element?.value || element?.selected_option?.value || element?.selected_date || null
      if (val) specificFields[label] = val
    }

    // Артефакти (URL поля)
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
      const { pageId, pageUrl } = await createNotionPage({
        name: name || taskTypeLabel,
        priority,
        deadline,
        format,
        platform,
        type: getNotionType(taskType),
        context,
        style,
        antiref,
        canEditText,
        specificFields,
        artifacts,
      })

      await saveTask({
        pageId,
        slackUserId: userId,
        slackChannelId: userId,
        taskName: name || taskTypeLabel,
      })

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
    } catch (err) {
      console.error('Error creating task:', err)
      await client.chat.postMessage({
        channel: userId,
        text: '❌ Щось пішло не так при створенні задачі. Спробуй ще раз або звернись до адміна.',
      })
    }
  })
}

function getNotionType(taskType) {
  const map = {
    static_simple: 'Brand Design',
    static_complex: 'Brand Design',
    carousel: 'Brand Design',
    promo_template: 'Brand Design',
    promo_new: 'Brand Design',
    resize: 'Brand Design',
    video_simple: 'Brand Design',
    video_complex: 'Brand Design',
    pres_edit: 'Brand Design',
    pres_template: 'Brand Design',
    pres_wow: 'Brand Design',
    ai_static_simple: 'Brand Design',
    ai_static_complex: 'Brand Design',
    ai_dynamic_simple: 'Brand Design',
    ai_dynamic_complex: 'Brand Design',
    landing_template: 'Brand Design',
    landing_wow: 'Brand Design',
    blog: 'Brand Design',
    digest_simple: 'Brand Design',
    digest_wow: 'Brand Design',
    email_digest: 'Brand Design',
    merch_simple: 'Brand Design',
    merch_ref: 'Brand Design',
    merch_research: 'Brand Design',
    identity: 'Brand Design',
    logo: 'Brand Design',
    photo_simple: 'Brand Design',
    photo_complex: 'Brand Design',
    tv_announce: 'Brand Design',
    tv_static: 'Brand Design',
    event_simple: 'Event',
    event_complex: 'Event',
  }
  return map[taskType] || 'Brand Design'
}