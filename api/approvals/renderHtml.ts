/**
 * HTML UI renderers for WhatsApp 1-Click Order Approval Gateway
 */

export function renderConfirmationPrompt(params: {
  orderId: string;
  decision: string;
  token: string;
  statusLabel: string;
  statusColor: string;
  isApprove: boolean;
}): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Подтверждение решения | Synergy B2B</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 32px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.05em;
      color: #ffffff;
      background: ${params.statusColor};
      margin-bottom: 16px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 12px;
      color: #0f172a;
    }
    p {
      color: #475569;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 14px 20px;
      font-size: 15px;
      font-weight: 600;
      color: #ffffff;
      background: ${params.statusColor};
      border: none;
      border-radius: 10px;
      cursor: pointer;
      box-sizing: border-box;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.9; }
    .footer {
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
      padding-top: 16px;
      margin-top: 24px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">${params.statusLabel}</div>
    <h1>Подтверждение действия</h1>
    <p>Вы собираетесь <strong>${params.isApprove ? 'ОДОБРИТЬ' : 'ОТКЛОНИТЬ'}</strong> отгрузку по заказу <strong>№${params.orderId}</strong>.</p>
    <form method="POST" action="/api/approvals/action">
      <input type="hidden" name="token" value="${params.token}">
      <button type="submit" class="btn">
        ${params.isApprove ? '✅ Подтвердить и одобрить заказ' : '❌ Подтвердить отклонение заказа'}
      </button>
    </form>
    <div class="footer">
      Synergy B2B Portal • Безопасный шлюз согласования
    </div>
  </div>
</body>
</html>`;
}

export function renderHtmlResult(success: boolean, message: string, badgeLabel?: string, badgeColor?: string, orderId?: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Решение по заказу | Synergy B2B</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 32px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
      text-align: center;
    }
    .icon-wrapper {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: ${success ? (badgeLabel === 'ОДОБРЕНИЕ' ? '#ecfdf5' : '#fef2f2') : '#fef2f2'};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 32px;
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.05em;
      color: #ffffff;
      background: ${badgeColor || '#64748b'};
      margin-bottom: 12px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 12px;
      color: #0f172a;
    }
    p {
      color: #475569;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px;
    }
    .footer {
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-wrapper">
      ${success ? (badgeLabel === 'ОДОБРЕНИЕ' ? '✅' : '❌') : '⚠️'}
    </div>
    ${badgeLabel ? `<div class="badge">${badgeLabel}</div>` : ''}
    <h1>${success ? 'Решение зафиксировано' : 'Ошибка обработки'}</h1>
    <p>${message}</p>
    <div class="footer">
      Synergy B2B Portal • Интеграционный шлюз ERP
    </div>
  </div>
</body>
</html>`;
}
