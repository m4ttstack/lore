use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

const SERVER_BINARY: &str = "lore-language-server";

struct LoreExtension;

impl zed::Extension for LoreExtension {
    fn new() -> Self {
        LoreExtension
    }

    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let configured = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);
        if let Some(binary) = configured {
            if let Some(path) = binary.path {
                // The server is a Node script, so its shebang needs the shell's PATH.
                let mut env = worktree.shell_env();
                env.extend(binary.env.unwrap_or_default());
                return Ok(zed::Command {
                    command: path,
                    args: binary.arguments.unwrap_or_default(),
                    env,
                });
            }
        }

        let path = worktree.which(SERVER_BINARY).ok_or_else(|| {
            format!(
                "{SERVER_BINARY} is not on PATH. Put it there, or set lsp.{SERVER_BINARY}.binary.path in Zed's settings."
            )
        })?;
        Ok(zed::Command {
            command: path,
            args: Vec::new(),
            env: worktree.shell_env(),
        })
    }
}

zed::register_extension!(LoreExtension);
