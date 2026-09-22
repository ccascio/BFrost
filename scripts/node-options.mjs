export function envWithSupportedNodeOption(env, option) {
  if (!process.allowedNodeEnvironmentFlags.has(option)) {
    return env;
  }

  const current = env.NODE_OPTIONS ?? '';
  const parts = current.split(/\s+/).filter(Boolean);
  if (parts.includes(option)) {
    return env;
  }

  return {
    ...env,
    NODE_OPTIONS: [...parts, option].join(' '),
  };
}

export function envWithSystemCa(env = process.env) {
  return envWithSupportedNodeOption(env, '--use-system-ca');
}
