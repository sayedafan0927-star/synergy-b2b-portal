/**
 * Enterprise Alerting Stack: Telegram & WhatsApp Dispatcher
 * Dispatches critical operational alerts for:
 * - Circuit Breaker state change (OPEN)
 * - Dead Letter Queue (DLQ) threshold breach
 * - 5xx Error spikes
 * - Inventory & Balance Reconciliation drift
 */

export interface SystemAlert {
  level: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  description: string;
  correlationId?: string;
  metadata?: Record<string, any>;
  timestamp?: string;
}

export async function sendSystemAlert(alert: SystemAlert): Promise<boolean> {
  const timestamp = alert.timestamp || new Date().toISOString();
  const icon = alert.level === 'CRITICAL' ? '🚨' : alert.level === 'WARNING' ? '⚠️' : 'ℹ️';

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_ALERTS_CHAT_ID;

  const formattedMsg = [
    `${icon} *[${alert.level}] ${alert.title}*`,
    `🕒 *Время:* \`${timestamp}\``,
    alert.correlationId ? `🔗 *Correlation ID:* \`${alert.correlationId}\`` : '',
    '',
    `📝 *Детали:*`,
    alert.description,
    alert.metadata ? `\n\`\`\`json\n${JSON.stringify(alert.metadata, null, 2)}\n\`\`\`` : '',
  ].filter(Boolean).join('\n');

  console.log(`[SystemAlert] ${alert.level}: ${alert.title} - ${alert.description}`);

  let sent = false;

  // 1. Отправка в Telegram Bot
  if (telegramBotToken && telegramChatId) {
    try {
      const tgUrl = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
      const res = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: formattedMsg,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
      if (res.ok) sent = true;
    } catch (tgErr) {
      console.warn('[SystemAlert] Telegram dispatch error:', tgErr);
    }
  }

  // 2. Fallback / дублирование в WhatsApp администратора
  const adminWhatsAppPhone = process.env.ADMIN_WHATSAPP_PHONE;
  const whatsappGatewayUrl = process.env.WHATSAPP_API_URL || process.env.GREEN_API_URL;
  const whatsappToken = process.env.WHATSAPP_API_TOKEN;

  if (alert.level === 'CRITICAL' && adminWhatsAppPhone && whatsappGatewayUrl) {
    try {
      await fetch(whatsappGatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(whatsappToken ? { 'Authorization': `Bearer ${whatsappToken}` } : {}),
        },
        body: JSON.stringify({
          phone: adminWhatsAppPhone.replace(/\D+/g, ''),
          message: `${icon} [CRITICAL ALERT]\n${alert.title}\n\n${alert.description}\nCorrelation: ${alert.correlationId || 'n/a'}`,
        }),
      });
      sent = true;
    } catch (waErr) {
      console.warn('[SystemAlert] WhatsApp dispatch error:', waErr);
    }
  }

  return sent;
}
