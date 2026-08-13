import "server-only";

import type { Environment } from "../../lib/config/env";
import {
  SUPABASE_BACKFILL_PUBLISH_RPC_NAME,
  SupabaseContentPersistenceRepository,
  SupabaseModelInvocationRepository,
  SupabasePipelineWorkspaceRepository,
  SupabasePublicationHistoryRepository,
  SupabasePublishReceiptRepository,
  SupabasePublisherRepository,
  SupabaseSourceAttemptRepository,
  type SupabasePipelineWorkspaceWriteAuthorityProvider,
  type SupabasePublicationPostMapper,
} from "../../repositories";
import {
  createSupabaseContentPersistenceRpcDataSource,
  SupabaseContentPersistenceConfigurationError,
} from "./content-persistence.data-source";
import {
  createSupabaseModelInvocationRpcDataSource,
  SupabaseModelInvocationConfigurationError,
} from "./model-invocation.data-source";
import {
  createSupabasePipelineWorkspaceDataSource,
  SupabasePipelineWorkspaceConfigurationError,
} from "./pipeline-workspace.data-source";
import {
  createSupabasePublishReceiptRpcDataSource,
  SupabasePublishReceiptConfigurationError,
} from "./publish-receipt.data-source";
import {
  createSupabasePublisherRpcDataSource,
  SupabasePublisherConfigurationError,
} from "./publisher.data-source";
import {
  createSupabaseSourceAttemptRpcDataSource,
  SupabaseSourceAttemptConfigurationError,
} from "./source-attempt.data-source";
import {
  createSupabasePublicationHistoryRpcDataSource,
  SupabasePublicationHistoryConfigurationError,
} from "./publication-history.data-source";

function requireServerConfig(environment: Environment): {
  projectUrl: string;
  secretKey: string;
} {
  if (
    environment.DATASTORE_PROVIDER !== "supabase" ||
    environment.SUPABASE_URL === undefined ||
    environment.SUPABASE_SECRET_KEY === undefined
  ) {
    throw new SupabaseContentPersistenceConfigurationError();
  }
  return {
    projectUrl: environment.SUPABASE_URL,
    secretKey: environment.SUPABASE_SECRET_KEY,
  };
}

export function createConfiguredSupabaseContentPersistenceRepository(
  environment: Environment,
): SupabaseContentPersistenceRepository {
  return new SupabaseContentPersistenceRepository(
    createSupabaseContentPersistenceRpcDataSource(requireServerConfig(environment)),
  );
}

export function createConfiguredSupabasePipelineWorkspaceRepository(
  environment: Environment,
  options: {
    writeAuthority: SupabasePipelineWorkspaceWriteAuthorityProvider;
    publicationPostMapper: SupabasePublicationPostMapper;
  },
): SupabasePipelineWorkspaceRepository {
  let config: ReturnType<typeof requireServerConfig>;
  try {
    config = requireServerConfig(environment);
  } catch {
    throw new SupabasePipelineWorkspaceConfigurationError();
  }
  return new SupabasePipelineWorkspaceRepository(
    createSupabasePipelineWorkspaceDataSource(config),
    options.writeAuthority,
    options.publicationPostMapper,
  );
}

export function createConfiguredSupabasePublisherRepository(
  environment: Environment,
): SupabasePublisherRepository {
  let config: ReturnType<typeof requireServerConfig>;
  try {
    config = requireServerConfig(environment);
  } catch {
    throw new SupabasePublisherConfigurationError();
  }
  return new SupabasePublisherRepository(
    createSupabasePublisherRpcDataSource(config),
  );
}

/**
 * Explicit operator-only publisher for the approved 2026-08-01..12 backfill.
 * It is intentionally absent from the normal configured pipeline bundle.
 */
export function createConfiguredSupabaseBackfillPublisherRepository(
  environment: Environment,
): SupabasePublisherRepository {
  let config: ReturnType<typeof requireServerConfig>;
  try {
    config = requireServerConfig(environment);
  } catch {
    throw new SupabasePublisherConfigurationError();
  }
  return new SupabasePublisherRepository(
    createSupabasePublisherRpcDataSource(config),
    SUPABASE_BACKFILL_PUBLISH_RPC_NAME,
  );
}

export function createConfiguredSupabaseModelInvocationRepository(
  environment: Environment,
): SupabaseModelInvocationRepository {
  let config: ReturnType<typeof requireServerConfig>;
  try {
    config = requireServerConfig(environment);
  } catch {
    throw new SupabaseModelInvocationConfigurationError();
  }
  return new SupabaseModelInvocationRepository(
    createSupabaseModelInvocationRpcDataSource(config),
  );
}

export function createConfiguredSupabasePublishReceiptRepository(
  environment: Environment,
): SupabasePublishReceiptRepository {
  let config: ReturnType<typeof requireServerConfig>;
  try {
    config = requireServerConfig(environment);
  } catch {
    throw new SupabasePublishReceiptConfigurationError();
  }
  return new SupabasePublishReceiptRepository(
    createSupabasePublishReceiptRpcDataSource(config),
  );
}

export function createConfiguredSupabaseSourceAttemptRepository(
  environment: Environment,
): SupabaseSourceAttemptRepository {
  let config: ReturnType<typeof requireServerConfig>;
  try {
    config = requireServerConfig(environment);
  } catch {
    throw new SupabaseSourceAttemptConfigurationError();
  }
  return new SupabaseSourceAttemptRepository(
    createSupabaseSourceAttemptRpcDataSource(config),
  );
}

export function createConfiguredSupabasePublicationHistoryRepository(
  environment: Environment,
): SupabasePublicationHistoryRepository {
  let config: ReturnType<typeof requireServerConfig>;
  try {
    config = requireServerConfig(environment);
  } catch {
    throw new SupabasePublicationHistoryConfigurationError();
  }
  return new SupabasePublicationHistoryRepository(
    createSupabasePublicationHistoryRpcDataSource(config),
  );
}
