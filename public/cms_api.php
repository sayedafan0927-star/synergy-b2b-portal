<?php
/**
 * Synergy B2B Portal — Server-Side CMS Media & Content Persistence Endpoint
 * Stores site_content.json and uploaded media (Hero video, country videos, posters, icons)
 * on the production server AND automatically resizes/crops/converts images to WebP via GD
 * so all visitors across all devices see exact-spec media immediately.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://synergy-group.kz');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Correlation-Id');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$rootDir = (basename(__DIR__) === 'dist') ? dirname(__DIR__) : __DIR__;
$distDir = (basename(__DIR__) === 'dist') ? __DIR__ : (__DIR__ . '/dist');

$storageDir = $rootDir . '/cms_storage';
$publicUploadsDir = __DIR__ . '/uploads/cms';
$altUploadsDir = (basename(__DIR__) === 'dist') ? ($rootDir . '/uploads/cms') : ($distDir . '/uploads/cms');

$htaccessGuard = "Options -Indexes\n<FilesMatch \"\\.(php|phtml|phar|php5|php7|php8|pl|py|cgi|sh|htaccess)$\">\n    <IfModule mod_authz_core.c>\n        Require all denied\n    </IfModule>\n    <IfModule !mod_authz_core.c>\n        Order allow,deny\n        Deny from all\n    </IfModule>\n</FilesMatch>\n";

foreach ([$storageDir, $publicUploadsDir, $altUploadsDir] as $dir) {
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    if (is_dir($dir) && !file_exists($dir . '/.htaccess')) {
        @file_put_contents($dir . '/.htaccess', $htaccessGuard);
    }
}

// Auto-restore any uploaded files from persistent storageDir into publicUploadsDir & altUploadsDir
if (is_dir($storageDir)) {
    $files = glob($storageDir . '/*.{mp4,webm,webp,png,jpg,jpeg}', GLOB_BRACE);
    if (is_array($files)) {
        foreach ($files as $f) {
            $base = basename($f);
            if (is_dir($publicUploadsDir) && !file_exists($publicUploadsDir . '/' . $base)) {
                @copy($f, $publicUploadsDir . '/' . $base);
            }
            if (is_dir($altUploadsDir) && !file_exists($altUploadsDir . '/' . $base)) {
                @copy($f, $altUploadsDir . '/' . $base);
            }
        }
    }
}

$contentFile = $storageDir . '/site_content.json';
$publicContentFile = __DIR__ . '/site_content.json';
$altContentFile = (basename(__DIR__) === 'dist') ? ($rootDir . '/site_content.json') : ($distDir . '/site_content.json');

// Auto-restore site_content.json to public webroot if missing
if (file_exists($contentFile)) {
    if (!file_exists($publicContentFile)) {
        @copy($contentFile, $publicContentFile);
    }
    if (is_dir(dirname($altContentFile)) && !file_exists($altContentFile)) {
        @copy($contentFile, $altContentFile);
    }
}

$action = isset($_GET['action']) ? (string)$_GET['action'] : 'get_content';

function decode_b64url(string $str): string {
    $pad = strlen($str) % 4;
    if ($pad > 0) {
        $str .= str_repeat('=', 4 - $pad);
    }
    return (string)base64_decode(strtr($str, '-_', '+/'));
}

function sanitize_cms_media_url($url): string {
    if (!is_string($url)) {
        return '';
    }
    $clean = trim($url);
    if ($clean === '') {
        return '';
    }
    // Strip CSS/HTML breakout characters
    $clean = preg_replace('/[\'"\(\);<>\\\\\x00-\x1F]/', '', $clean);
    $lower = strtolower($clean);
    if (
        strpos($lower, 'javascript:') === 0 ||
        strpos($lower, 'vbscript:') === 0 ||
        strpos($lower, 'data:text/') === 0
    ) {
        return '';
    }
    if (
        strpos($clean, '/') === 0 ||
        strpos($lower, 'idb://') === 0 ||
        strpos($lower, 'https://') === 0
    ) {
        return $clean;
    }
    return '';
}

function sanitize_site_content_payload(array $sc): array {
    if (isset($sc['hero']) && is_array($sc['hero'])) {
        foreach (['videoMp4', 'videoWebm', 'posterUrl', 'endCardUrl'] as $k) {
            if (isset($sc['hero'][$k])) {
                $sc['hero'][$k] = sanitize_cms_media_url($sc['hero'][$k]);
            }
        }
    }
    if (isset($sc['b2bCta']) && is_array($sc['b2bCta']) && isset($sc['b2bCta']['backgroundUrl'])) {
        $sc['b2bCta']['backgroundUrl'] = sanitize_cms_media_url($sc['b2bCta']['backgroundUrl']);
    }
    if (isset($sc['categories']) && is_array($sc['categories'])) {
        foreach ($sc['categories'] as $idx => $cat) {
            if (is_array($cat)) {
                foreach (['video', 'poster', 'image'] as $k) {
                    if (isset($cat[$k])) {
                        $sc['categories'][$idx][$k] = sanitize_cms_media_url($cat[$k]);
                    }
                }
            }
        }
    }
    if (isset($sc['advantages']) && is_array($sc['advantages'])) {
        foreach ($sc['advantages'] as $idx => $adv) {
            if (is_array($adv) && isset($adv['image'])) {
                $sc['advantages'][$idx]['image'] = sanitize_cms_media_url($adv['image']);
            }
        }
    }
    return $sc;
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
    if (strlen($token) < 24) {
        return false;
    }

    // 1. Check 3-segment JWT (header.payload.signature)
    $parts = explode('.', $token);
    if (count($parts) === 3 && strlen($parts[2]) >= 16) {
        $payloadRaw = decode_b64url($parts[1]);
        if ($payloadRaw) {
            $payload = json_decode($payloadRaw, true);
            if (is_array($payload)) {
                $role = $payload['role']
                    ?? ($payload['user_metadata']['role'] ?? '')
                    ?? ($payload['app_metadata']['role'] ?? '')
                    ?? ($payload['data']['role'] ?? '');
                $hasIdentity = !empty($payload['sub']) || !empty($payload['id']) || !empty($payload['email']);
                $notExpired = empty($payload['exp']) || ((int)$payload['exp'] > (time() - 300));
                if ($role === 'admin' && $hasIdentity && $notExpired) {
                    return true;
                }
            }
        }
    }

    // 2. Check structured portal session token (buildFallbackToken) with strict identity + timestamp validation
    $singleRaw = decode_b64url($token);
    if ($singleRaw) {
        $parsed = json_decode($singleRaw, true);
        if (is_array($parsed)) {
            $role = $parsed['role']
                ?? ($parsed['data']['role'] ?? '')
                ?? ($parsed['data']['profile']['role'] ?? '');
            $source = $parsed['source'] ?? '';
            $id = $parsed['id'] ?? ($parsed['data']['id'] ?? '');
            $email = $parsed['email'] ?? ($parsed['data']['email'] ?? '');
            $rawTs = isset($parsed['timestamp']) ? (int)$parsed['timestamp'] : 0;
            $tsSec = ($rawTs > 2000000000) ? (int)floor($rawTs / 1000) : $rawTs;
            $freshEnough = ($tsSec > (time() - 7 * 86400)) && ($tsSec <= (time() + 3600));

            if (
                $role === 'admin' &&
                $source === 'portal_session' &&
                is_string($id) && strlen($id) >= 3 &&
                is_string($email) && strpos($email, '@') !== false &&
                $freshEnough
            ) {
                return true;
            }
        }
    }

    return false;
}

function get_slot_target_spec(string $slot): array {
    if ($slot === 'heroPoster') {
        return ['w' => 1920, 'h' => 1080, 'mode' => 'cover', 'alpha' => false];
    }
    if ($slot === 'heroEndCard') {
        return ['w' => 964, 'h' => 714, 'mode' => 'contain', 'alpha' => true];
    }
    if ($slot === 'b2bBackgroundUrl') {
        return ['w' => 2560, 'h' => 1138, 'mode' => 'cover', 'alpha' => false];
    }
    if (strpos($slot, 'cat_') === 0) {
        return ['w' => 720, 'h' => 720, 'mode' => 'contain', 'alpha' => false];
    }
    if (strpos($slot, 'adv_') === 0) {
        return ['w' => 512, 'h' => 512, 'mode' => 'contain', 'alpha' => true];
    }
    return ['w' => 1920, 'h' => 1080, 'mode' => 'cover', 'alpha' => false];
}

function auto_fit_image_gd(string $srcPath, string $destWebpPath, string $slot): bool {
    if (!extension_loaded('gd') || !function_exists('imagewebp')) {
        return false;
    }
    $info = @getimagesize($srcPath);
    if (!$info || empty($info[0]) || empty($info[1])) {
        return false;
    }
    $srcW = (int)$info[0];
    $srcH = (int)$info[1];
    $mime = isset($info['mime']) ? $info['mime'] : '';

    $spec = get_slot_target_spec($slot);
    $dstW = $spec['w'];
    $dstH = $spec['h'];

    if ($srcW === $dstW && $srcH === $dstH && $mime === 'image/webp') {
        return @copy($srcPath, $destWebpPath);
    }

    $srcImg = null;
    if ($mime === 'image/jpeg') {
        $srcImg = @imagecreatefromjpeg($srcPath);
    } elseif ($mime === 'image/png') {
        $srcImg = @imagecreatefrompng($srcPath);
    } elseif ($mime === 'image/webp' && function_exists('imagecreatefromwebp')) {
        $srcImg = @imagecreatefromwebp($srcPath);
    }
    if (!$srcImg) {
        return false;
    }

    $dstImg = imagecreatetruecolor($dstW, $dstH);
    if ($spec['alpha']) {
        imagealphablending($dstImg, false);
        imagesavealpha($dstImg, true);
        $transparent = imagecolorallocatealpha($dstImg, 0, 0, 0, 127);
        imagefilledrectangle($dstImg, 0, 0, $dstW, $dstH, $transparent);
    } else {
        $black = imagecolorallocate($dstImg, 0, 0, 0);
        imagefilledrectangle($dstImg, 0, 0, $dstW, $dstH, $black);
    }

    $scale = ($spec['mode'] === 'cover')
        ? max($dstW / $srcW, $dstH / $srcH)
        : min($dstW / $srcW, $dstH / $srcH);

    $drawW = (int)round($srcW * $scale);
    $drawH = (int)round($srcH * $scale);
    $offsetX = (int)round(($dstW - $drawW) / 2);
    $offsetY = (int)round(($dstH - $drawH) / 2);

    imagecopyresampled($dstImg, $srcImg, $offsetX, $offsetY, 0, 0, $drawW, $drawH, $srcW, $srcH);
    $saved = @imagewebp($dstImg, $destWebpPath, 86);
    imagedestroy($srcImg);
    imagedestroy($dstImg);
    return (bool)$saved;
}

if ($action === 'get_content') {
    $candidates = [$contentFile, $publicContentFile, $altContentFile];
    $bestContent = null;
    $bestUpdated = '';
    foreach ($candidates as $cand) {
        if (file_exists($cand)) {
            $raw = @file_get_contents($cand);
            $decoded = $raw ? json_decode($raw, true) : null;
            if (is_array($decoded)) {
                $upd = isset($decoded['updatedAt']) ? (string)$decoded['updatedAt'] : '';
                if ($bestContent === null || strcmp($upd, $bestUpdated) > 0) {
                    $bestContent = $decoded;
                    $bestUpdated = $upd;
                }
            }
        }
    }
    if (is_array($bestContent)) {
        echo json_encode(['success' => true, 'site_content' => $bestContent], JSON_UNESCAPED_UNICODE);
        exit;
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

    $siteContent = sanitize_site_content_payload($siteContent);
    $siteContent['updatedAt'] = gmdate('Y-m-d\TH:i:s\Z');
    $encoded = json_encode($siteContent, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (@file_put_contents($contentFile, $encoded, LOCK_EX) === false) {
        http_response_code(500);
        echo json_encode(['success' => false, 'error' => 'Failed to write site_content.json'], JSON_UNESCAPED_UNICODE);
        exit;
    }
    @file_put_contents($publicContentFile, $encoded, LOCK_EX);
    if (is_dir(dirname($altContentFile))) {
        @file_put_contents($altContentFile, $encoded, LOCK_EX);
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

    if ($fileSize <= 0 || $fileSize > 60 * 1024 * 1024) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Размер файла должен быть до 60 МБ'], JSON_UNESCAPED_UNICODE);
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

    $isImage = in_array($ext, ['webp', 'png', 'jpg', 'jpeg'], true);
    $finalExt = $isImage ? 'webp' : $ext;
    $safeFileName = ($slot ?: 'media') . '_' . time() . '_' . substr(md5(uniqid('', true)), 0, 6) . '.' . $finalExt;
    $destPublic = $publicUploadsDir . '/' . $safeFileName;
    $destBackup = $storageDir . '/' . $safeFileName;
    $destAlt = $altUploadsDir . '/' . $safeFileName;

    $processedByGd = false;
    if ($isImage) {
        $processedByGd = auto_fit_image_gd($tmpPath, $destPublic, $slot);
    }
    if (!$processedByGd) {
        if (!@move_uploaded_file($tmpPath, $destPublic)) {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'Не удалось сохранить файл на сервере'], JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
    @copy($destPublic, $destBackup);
    if (is_dir($altUploadsDir)) {
        @copy($destPublic, $destAlt);
    }

    $publicUrl = '/uploads/cms/' . $safeFileName;
    echo json_encode([
        'success' => true,
        'url' => $publicUrl,
        'fileName' => $safeFileName,
        'sizeBytes' => @filesize($destPublic) ?: $fileSize,
        'autoFitted' => $processedByGd,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

http_response_code(400);
echo json_encode(['success' => false, 'error' => 'Unknown action'], JSON_UNESCAPED_UNICODE);
