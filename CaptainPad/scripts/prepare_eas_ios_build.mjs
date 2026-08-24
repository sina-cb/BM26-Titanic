import { spawnSync } from 'node:child_process';

const IOS_PLATFORM = 'ios';

function main() {
  const platform = process.env.EAS_BUILD_PLATFORM;
  if (!platform) {
    console.error('EAS_BUILD_PLATFORM is required for the EAS post-install step.');
    process.exit(1);
  }

  if (platform !== IOS_PLATFORM) {
    console.log(`No Apple toolchain preparation is required for ${platform}.`);
    return;
  }

  const result = spawnSync(
    'xcodebuild',
    ['-downloadComponent', 'MetalToolchain'],
    { stdio: 'inherit' },
  );

  if (result.error) {
    console.error(`Could not prepare the Metal toolchain: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`Metal toolchain preparation exited with status ${result.status}.`);
    process.exit(result.status ?? 1);
  }

  console.log('Metal toolchain is ready for the iOS production build.');
}

main();
