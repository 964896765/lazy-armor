import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CREDENTIAL_PROVIDER, type CredentialProvider } from './credential-provider';
import { LocalEncryptedCredentialProvider } from './local-encrypted-credential.provider';

@Module({
  providers: [
    LocalEncryptedCredentialProvider,
    {
      provide: CREDENTIAL_PROVIDER,
      inject: [ConfigService, LocalEncryptedCredentialProvider],
      useFactory: (config: ConfigService, local: LocalEncryptedCredentialProvider): CredentialProvider => {
        const env = config.get<string>('NODE_ENV');
        const selected = config.get<string>('CREDENTIAL_PROVIDER');
        // 生产环境 fail-closed：仅允许显式 production provider，绝不回落到本地文件存储。
        if (env === 'production') {
          if (selected !== 'production') {
            throw new Error('Production requires CREDENTIAL_PROVIDER=production (LocalEncryptedCredentialProvider is development/test only)');
          }
          // 尚未接入真实托管 Provider（Vault/KMS/SecretsManager）：拒绝启动，避免本地文件凭据冒充生产。
          throw new Error('No production Credential Provider is registered; refusing to start with side-effect capability');
        }
        return local;
      },
    },
  ],
  exports: [CREDENTIAL_PROVIDER],
})
export class CredentialsModule {}
