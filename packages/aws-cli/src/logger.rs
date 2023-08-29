use std::{
    str::FromStr,
    sync::{Arc, Mutex, OnceLock},
};
use tracing_subscriber::{
    filter::LevelFilter,
    fmt::Layer as FormatLayer,
    layer::Layered,
    prelude::*,
    reload::{Handle, Layer},
    EnvFilter, Registry,
};

pub struct ReloadHandles<R = Registry, L = FormatLayer<R>, S = Layered<Layer<L, R>, R>> {
    pub fmt_reload: Handle<L, R>,
    pub env_filter_reload: Handle<EnvFilter, S>,
}

pub fn env_filter(set_env: Option<&str>) -> EnvFilter {
    const ALWAYS: &str = ",rustls::conn=off";
    static ENV: OnceLock<Arc<Mutex<String>>> = OnceLock::new();
    let s = ENV.get_or_init(|| Arc::new(Mutex::new(set_env.unwrap_or("").to_string())));
    let mut sl = s.lock().unwrap();
    if let Some(set) = set_env {
        *sl = set.to_string();
    }
    EnvFilter::from_str(&format!("{}{}", sl, ALWAYS)).unwrap()
}

pub fn tracing() -> &'static ReloadHandles {
    static TRACING: OnceLock<ReloadHandles> = OnceLock::new();
    TRACING.get_or_init(|| {
        let (fmt, fmt_reload) = Layer::new(FormatLayer::new());
        let (env_filter, env_filter_reload) = Layer::new(env_filter(None));

        tracing_subscriber::registry()
            .with(fmt)
            .with(env_filter)
            .init();

        ReloadHandles {
            fmt_reload,
            env_filter_reload,
        }
    })
}

pub fn set_level(level: usize) -> anyhow::Result<()> {
    let filter: LevelFilter = match level {
        0 => LevelFilter::OFF,
        1 => LevelFilter::ERROR,
        2 => LevelFilter::WARN,
        3 => LevelFilter::INFO,
        4 => LevelFilter::DEBUG,
        5 => LevelFilter::TRACE,
        _ => anyhow::bail!("Invalid level"),
    };
    tracing()
        .env_filter_reload
        .reload(env_filter(Some(&filter.to_string())))
        .map_err(anyhow::Error::from)?;
    Ok(())
}

pub fn toggle_debug_mode(enabled: bool) -> anyhow::Result<()> {
    let handles = tracing();
    let layer = FormatLayer::new();
    handles
        .fmt_reload
        .reload(if enabled {
            layer
                .with_line_number(true)
                .with_thread_ids(true)
                .with_thread_names(true)
                .with_file(true)
        } else {
            layer
        })
        .map_err(anyhow::Error::from)
}

pub fn init() {
    env_filter(Some(&format!("{}", LevelFilter::OFF)));
    tracing();
    toggle_debug_mode(true).expect("toggle debug mode");
}
