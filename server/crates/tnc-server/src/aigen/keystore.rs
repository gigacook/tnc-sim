//! The OpenRouter key, kept on the server only.
//!
//! Two sources: a key an admin stored through the API (file `openrouter.key` in the data folder) and
//! the `OPENROUTER_API_KEY` environment value. The stored key wins. The key never goes into the
//! database (so a copy of `tnc.db` holds no key), never into a response and never into a log line:
//! this type has no `Serialize`, and its `Debug` prints only whether a key is present.
//!
//! The file is the only protection at rest: owner-only permissions (0600 on Unix; on Windows the
//! inherited ACL entries are removed and the current user is granted access, best effort). It is not
//! encrypted: the codebase has no secret store to follow, and an encryption key kept beside the file
//! would add nothing.

use std::fmt;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

pub const FILE_NAME: &str = "openrouter.key";
const MAX_KEY_LEN: usize = 512;

pub struct KeyStore {
    path: PathBuf,
    env: Option<String>,
    stored: RwLock<Option<String>>,
}

impl fmt::Debug for KeyStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeyStore").field("present", &self.present()).field("stored", &self.stored()).finish()
    }
}

/// Why a key was refused. The text never repeats the key.
#[derive(Debug, PartialEq, Eq)]
pub struct InvalidKey(pub &'static str);

pub fn validate(key: &str) -> Result<&str, InvalidKey> {
    let k = key.trim();
    if k.is_empty() {
        return Err(InvalidKey("the key is empty"));
    }
    if k.len() > MAX_KEY_LEN {
        return Err(InvalidKey("the key is too long (512 characters at most)"));
    }
    if !k.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(InvalidKey("the key may only hold printable characters without spaces"));
    }
    Ok(k)
}

impl KeyStore {
    /// Reads the stored key, if any. An unreadable or malformed file counts as no stored key.
    pub fn load(data_dir: &Path, env_key: Option<&str>) -> KeyStore {
        let path = data_dir.join(FILE_NAME);
        let stored = std::fs::read_to_string(&path).ok().and_then(|s| validate(&s).ok().map(str::to_owned));
        let env = env_key.map(str::trim).filter(|k| !k.is_empty()).map(str::to_owned);
        KeyStore { path, env, stored: RwLock::new(stored) }
    }

    /// The key to use upstream: the stored one, else the environment's.
    pub fn get(&self) -> Option<String> {
        self.stored.read().unwrap().clone().or_else(|| self.env.clone())
    }

    pub fn present(&self) -> bool {
        self.stored() || self.env.is_some()
    }

    /// True when a key was stored through the API (the one `delete` removes).
    pub fn stored(&self) -> bool {
        self.stored.read().unwrap().is_some()
    }

    /// Stores the key: a new file written beside the old one, then renamed over it.
    pub fn set(&self, key: &str) -> std::io::Result<()> {
        let mut guard = self.stored.write().unwrap();
        let tmp = self.path.with_extension("key.tmp");
        let _ = std::fs::remove_file(&tmp);
        {
            let mut f = open_private(&tmp)?;
            f.write_all(key.as_bytes())?;
            f.sync_all()?;
        }
        restrict(&tmp);
        std::fs::rename(&tmp, &self.path)?;
        *guard = Some(key.to_owned());
        Ok(())
    }

    /// Removes the stored key. The environment key, if there is one, stays in use.
    pub fn delete(&self) -> std::io::Result<()> {
        let mut guard = self.stored.write().unwrap();
        match std::fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        *guard = None;
        Ok(())
    }
}

#[cfg(unix)]
fn open_private(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(path)
}

#[cfg(not(unix))]
fn open_private(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new().write(true).create_new(true).open(path)
}

#[cfg(unix)]
fn restrict(_: &Path) {}

/// Windows: drop inherited ACL entries and leave the current user as the only one with access.
/// Best effort: when it fails the file keeps the data folder's ACL, and a warning says so.
#[cfg(windows)]
fn restrict(path: &Path) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let Ok(user) = std::env::var("USERNAME") else {
        tracing::warn!("could not restrict the key file (no USERNAME): it keeps the data folder's permissions");
        return;
    };
    let done = std::process::Command::new("icacls")
        .arg(path)
        .args(["/inheritance:r", "/grant:r", &format!("{user}:F")])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    if !done.is_ok_and(|s| s.success()) {
        tracing::warn!("could not restrict the key file: it keeps the data folder's permissions");
    }
}

#[cfg(not(any(unix, windows)))]
fn restrict(_: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_key_wins_over_the_environment_and_survives_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let ks = KeyStore::load(dir.path(), Some("  env-key  "));
        assert!(ks.present() && !ks.stored());
        assert_eq!(ks.get().as_deref(), Some("env-key"));
        ks.set("sk-or-stored").unwrap();
        assert!(ks.stored());
        assert_eq!(ks.get().as_deref(), Some("sk-or-stored"));
        assert_eq!(std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap(), "sk-or-stored");
        assert!(!dir.path().join("openrouter.key.tmp").exists());

        let again = KeyStore::load(dir.path(), None);
        assert_eq!(again.get().as_deref(), Some("sk-or-stored"));
        again.set("sk-or-second").unwrap();
        assert_eq!(KeyStore::load(dir.path(), None).get().as_deref(), Some("sk-or-second"));

        again.delete().unwrap();
        again.delete().unwrap(); // twice is fine
        assert!(!again.present());
        assert!(!dir.path().join(FILE_NAME).exists());
        assert_eq!(KeyStore::load(dir.path(), Some("env-key")).get().as_deref(), Some("env-key"));
    }

    #[test]
    fn debug_never_prints_the_key() {
        let dir = tempfile::tempdir().unwrap();
        let ks = KeyStore::load(dir.path(), Some("sk-or-env-secret"));
        ks.set("sk-or-file-secret").unwrap();
        let s = format!("{ks:?}");
        assert!(!s.contains("secret"), "{s}");
        assert!(s.contains("present: true"), "{s}");
    }

    #[test]
    fn key_shape() {
        assert_eq!(validate("  sk-or-v1-abc  "), Ok("sk-or-v1-abc"));
        assert!(validate("   ").is_err());
        assert!(validate("two words").is_err());
        assert!(validate("line\nbreak").is_err());
        assert!(validate(&"k".repeat(513)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let ks = KeyStore::load(dir.path(), None);
        ks.set("sk-or-stored").unwrap();
        let mode = std::fs::metadata(dir.path().join(FILE_NAME)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
