# Testing

## Setup

If you haven't setup `matrix-public-archive` yet, see the [_Setup_ section in the root `README.md`](../README.md#setup)

Sorry, this isn't automated yet when you run the tests 🙇

```sh
$ docker pull matrixdotorg/synapse:latest
$ docker build -t matrix-public-archive-test-homeserver -f test/dockerfiles/Synapse.Dockerfile test/dockerfiles/

$ docker-compose --project-name matrix_public_archive_test -f test/docker-compose.yml up -d --no-recreate
```

## Running the tests

```sh
$ npm run test
```

Or if you want to keep `matrix-public-archive` server running after the tests run and explore the output from the interactive URL's printed on the screen, use:

```sh
$ npm run test-interactive
```

### Developer utility

macOS:

```sh
$ docker ps --all | grep test_hs
$ docker logs -f --tail 10 matrix_public_archive_test-hs1-1
$ docker logs -f --tail 10 matrix_public_archive_test-hs2-1

$ docker stop matrix_public_archive_test-hs1-1 matrix_public_archive_test-hs2-1
$ docker rm matrix_public_archive_test-hs1-1 matrix_public_archive_test-hs2-1
```

Windows:

```sh
$ docker ps --all | grep test_hs
$ docker logs -f --tail 10 matrix_public_archive_test_hs1_1
$ docker logs -f --tail 10 matrix_public_archive_test_hs2_1

$ docker stop matrix_public_archive_test_hs1_1 matrix_public_archive_test_hs2_1
$ docker rm matrix_public_archive_test_hs1_1 matrix_public_archive_test_hs2_1
```
