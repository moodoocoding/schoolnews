import "server-only";

import type { Environment } from "../../lib/config/env";
import {
  SupabaseContentPersistenceRepository,
  SupabasePipelineWorkspaceRepository,
  SupabasePublisherRepository,
  type SupabasePipelineWorkspaceWriteAuthorityProvider,
  type SupabasePublicationPostMapper,
} from "../../repositories";
import {
  createSupabaseContentPersistenceRpcDataSource,
  SupabaseContentPersistenceConfigurationError,
} from "./content-persistence.data-source";
import {
  createSupabasePipelineWorkspaceDataSource,
  SupabasePipelineWorkspaceConfigurationError,
} from "./pipeline-workspace.data-source";
import {
  createSupabasePublisherRpcDataSource,
  SupabasePublisherConfigurationError,
} from "./publisher.data-source";

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
