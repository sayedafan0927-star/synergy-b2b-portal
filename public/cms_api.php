<?php
/**
 * Synergy B2B Portal — Server-Side CMS Media & Content Persistence Endpoint
 * Stores site_content.json and uploaded media (Hero video, country videos, posters, icons)
 * on the production server so all visitors across all devices see updates immediately.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://synergy-group.kz');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Correlation-Id');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$storageDir = dirname(__DIR__) . '/cms_storage';
$publicUploadsDir = __DIR__ . '/uploads/cms';

if (!is_dir($storageDir)) {
    @mkdir($storageDir, 0755, true);
}
if (!is_dir($publicUploadsDir)) {
    @mkdir($publicUploadsDir, 0755, true);
}

// Auto-restore any uploaded files from persistent storageDir into publicUploadsDir
if (is_dir($storageDir) && is_dir($publicUploadsDir)) {
    $files = glob($storageDir . '/*.{mp4,webm,webp,png,jpg,jpeg}', GLOB_BRACE);
    if (is_array($files)) {
        foreach ($files as $f) {
            $target = $publicUploadsDir . '/' . basename($f);
            if (!file_exists($target)) {
                @copy($f, $target);
            }
        }
    }
}

$contentFile = $storageDir . '/site_content.json';
$action = isset($_GET['action']) ? (string)$_GET['action'] : 'get_content';

function decode_b64url(string $str): string {
    $pad = strlen($str) % 4;
    if ($pad > 0) {
        $str .= str_repeat('=', 4 - $pad);
    }
    return (string)base64_decode(strtr($str, '-_', '+/'));
}

function verify_admin_authorization(): bool {
    $authHeader = '';
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
    } elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $authHeader = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    } elseif (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $k => $v) {
            if (strtolower($k) === 'authorization') {
                $authHeader = $v;
                break;
            }
        }
    }

    if (strpos($authHeader, 'Bearer ') !== 0) {
        return false;
    }
    $token = trim(substr($authHeader, 7));
    if (strlen($token) < 12) {
        return false;
    }

    // 1. Check multi-segment JWT (header.payload.signature)
    $parts = explode('.', $token);
    if (count($parts) >= 2) {
        $payloadRaw = decode_b64url($parts[1]);
        if ($payloadRaw) {
            $payload = json_decode($payloadRaw, true);
            if (is_array($payload)) {
                $role = $payload['role'] ?? ($payload['user_metadata']['role'] ?? ($payload['data']['role'] ?? ''));
                if ($role === 'admin') {
                    return true;
                }
            }
        }
    }

    // 2. Check single-segment base64url portal session token (buildFallbackToken)
    $singleRaw = decode_b64url($token);
    if ($singleRaw) {
        $parsed = json_decode($singleRaw, true);
        if (is_array($parsed)) {
            $role = $parsed['role']
                ?? ($parsed['data']['role'] ?? '')
                ?? ($parsed['data']['profile']['role'] ?? '');
            if ($role === 'admin') {
                return true;
            }
        }
    }

    return false;
}

if ($action === 'get_content') {
    if (file_exists($contentFile)) {
        $raw = @file_get_contents($contentFile);
        $decoded = $raw ? json_decode($raw, true) : null;
        if (is_array($decoded)) {
            echo json_encode(['success' => true, 'site_content' => $decoded], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
    echo json_encode(['success' => true, 'site_content' => null], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed'], JSON_UNESCAPED_UNICODE);
    exit;
}

if (!verify_admin_authorization()) {
    http_response_code(403);
    echo json_encode(['success' => false, 'error' => 'Forbidden: Admin authorization required'], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'save_content') {
    $rawBody = file_get_contents('php://input');
    $body = $rawBody ? json_decode($rawBody, true) : null;
    $siteContent = isset($body['site_content']) ? $body['site_content'] : $body;

    if (!is_array($siteContent)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid site_content JSON payload'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $siteContent['updatedAt'] = gmdate('Y-m-d\TH:i:s\Z');
    $encoded = json_encode($siteContent, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (@file_put_contents($contentFile, $encoded, LOCK_EX) === false) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to write site_content.json'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    echo json_encode([
        'success' => true,
        'message' => 'Контент сайта сохранён на сервере',
        'site_content' => $siteContent,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'upload') {
    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        $errCode = isset($_FILES['file']['error']) ? $_FILES['file']['error'] : -1;
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'File upload error code: ' . $errCode], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $tmpPath = $_FILES['file']['tmp_name'];
    $origName = basename($_FILES['file']['name']);
    $fileSize = (int)$_FILES['file']['size'];
    $slot = isset($_POST['slot']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$_POST['slot']) : 'media';

    if ($fileSize <= 0 || $fileSize > 35 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Размер файла должен быть до 35 МБ'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
    $allowedExts = ['mp4', 'webm', 'webp', 'png', 'jpg', 'jpeg'];
    if (!in_array($ext, $allowedExts, true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Недопустимый формат файла: .' . $ext], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if (function_exists('finfo_open')) {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $mime = finfo_file($finfo, $tmpPath);
        finfo_close($finfo);
        $allowedMimes = [
            'video/mp4', 'video/webm', 'application/octet-stream',
            'image/webp', 'image/png', 'image/jpeg',
        ];
        if ($mime && !in_array($mime, $allowedMimes, true)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Недопустимый MIME-тип файла: ' . $mime], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }

    $safeFileName = ($slot ?: 'media') . '_' . time() . '_' . substr(md5(uniqid('', true)), 0, 6) . '.' . $ext;
    $destPublic = $publicUploadsDir . '/' . $safeFileName;
    $destBackup = $storageDir . '/' . $safeFileName;

    if (!@move_uploaded_file($tmpPath, $destPublic)) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Не удалось сохранить файл на сервере'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    @copy($destPublic, $destBackup);

    $publicUrl = '/uploads/cms/' . $safeFileName;
    echo json_encode([
        'success' => true,
        'url' => $publicUrl,
        'fileName' => $safeFileName,
        'sizeBytes' => $fileSize,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(400);
echo json_encode(['success' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
