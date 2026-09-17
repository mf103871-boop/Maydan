// Paddle datasets are separate. Never infer that an unclassified historical row
// belongs to the currently configured account; a verified webhook can classify it.
export const paddleEnvironmentOf = (env) => env.PADDLE_ENV === 'production' ? 'production' : 'sandbox';
export const inBillingEnvironment = (env, row) => row.source !== 'paddle'
  || row.environment === paddleEnvironmentOf(env);
