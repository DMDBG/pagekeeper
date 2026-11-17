// Installing a new version. The page downloads Pagekeeper-Setup.exe from this app's own GitHub
// releases and hands the bytes here; this saves it, closes Pagekeeper, runs the installer quietly,
// and opens Pagekeeper again when it's done.
use std::process::Command;
use tauri::AppHandle;

#[tauri::command]
pub fn pk_install_update(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the installer's bytes.".to_string());
    };
    // A Windows program starts with "MZ"; anything else (or something tiny) isn't the installer.
    if bytes.len() < 1_000_000 || &bytes[0..2] != b"MZ" {
        return Err("That download isn't a Pagekeeper installer.".to_string());
    }
    let dir = std::env::temp_dir().join("pagekeeper-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let setup = dir.join("Pagekeeper-Setup.exe");
    std::fs::write(&setup, bytes).map_err(|e| e.to_string())?;
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    // Wait a moment for Pagekeeper to close, install without questions (/S), then reopen it.
    let script = format!(
        "ping -n 3 127.0.0.1 >nul & start \"\" /wait \"{}\" /S & start \"\" \"{}\"",
        setup.display(),
        me.display()
    );
    let mut cmd = Command::new("cmd");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.raw_arg(format!("/S /C \"{script}\""));
        cmd.creation_flags(0x0800_0000); // no console window
    }
    cmd.spawn().map_err(|e| format!("Couldn't start the installer: {e}"))?;
    app.exit(0);
    Ok(())
}
