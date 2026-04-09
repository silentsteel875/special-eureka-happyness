<?php
/**
 * verify-session.php
 * This script validates the user and "emulates" their AI Pro profile.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: https://outlook.office.com');
header('Access-Control-Allow-Credentials: true');

session_start();

// 1. Get the payload from the Userscript
$input = json_decode(file_get_contents('php://input'), true);
$identityHint = $input['identity_hint'] ?? null;

if (!$identityHint) {
    echo json_encode(['status' => 'error', 'message' => 'No identity provided']);
    exit;
}

/**
 * 2. THE VALIDATE STEP
 * In a production app, you would verify a JWT token here.
 * For our POC, we are trusting the hint if it comes from our approved domain.
 */
function validateUser($hint) {
    // Logic to check if user exists in your NY.gov directory
    return (strpos($hint, '@') !== false); 
}

if (validateUser($identityHint)) {
    /**
     * 3. THE IMPERSONATE STEP
     * We populate the session with the user's profile data.
     * This "emulates" the logged-in user so the app doesn't ask for a login.
     */
    $_SESSION['user_id'] = $identityHint;
    $_SESSION['is_authenticated'] = true;
    $_SESSION['last_sync'] = time();

    // Set a secure, same-site cookie that works in iframes
    setcookie("AI_PRO_SESSION", session_id(), [
        'expires' => time() + 3600,
        'path' => '/',
        'domain' => 'pro.ai.ny.gov',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'None', // REQUIRED for iframes!
    ]);

    echo json_encode(['status' => 'success']);
} else {
    echo json_encode(['status' => 'error', 'message' => 'Unauthorized']);
}
