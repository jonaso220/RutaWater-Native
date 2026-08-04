import fs from 'fs';
import path from 'path';

describe('Android release signing configuration', () => {
  const root = process.cwd();

  test('does not keep release credentials in tracked Gradle properties', () => {
    const gradleProperties = fs.readFileSync(
      path.join(root, 'android/gradle.properties'),
      'utf8',
    );
    expect(gradleProperties).not.toMatch(/^RUTAWATER_UPLOAD_/m);
  });

  test('uses an ignored local file with a secret-free template', () => {
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    const template = fs.readFileSync(
      path.join(root, 'android/keystore.properties.example'),
      'utf8',
    );
    const buildGradle = fs.readFileSync(
      path.join(root, 'android/app/build.gradle'),
      'utf8',
    );

    expect(gitignore).toContain('android/keystore.properties');
    expect(template).toMatch(/^RUTAWATER_UPLOAD_KEY_ALIAS=$/m);
    expect(template).toMatch(/^RUTAWATER_UPLOAD_STORE_PASSWORD=$/m);
    expect(template).toMatch(/^RUTAWATER_UPLOAD_KEY_PASSWORD=$/m);
    expect(buildGradle).toContain('rootProject.file("keystore.properties")');
    expect(buildGradle).toContain('requestsReleaseArtifact');
    expect(buildGradle).toContain('releaseSigningTaskNamePatterns');
    expect(buildGradle).toContain('^(assemble|bundle|install)Release$');
    expect(buildGradle).toContain('^validateSigningRelease$');
    expect(buildGradle).not.toContain('.contains("release")');
  });
});
