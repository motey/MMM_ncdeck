docker stop magic_mirror_test_instance
docker rm magic_mirror_test_instance
docker run  -it \
    --publish 8080:8080 \
    --volume ${PWD}/config:/opt/magic_mirror/config \
    --volume ${PWD}/../:/opt/magic_mirror/modules/MMM_ncdeck \
    --volume /etc/localtime:/etc/localtime:ro \
    --name magic_mirror_test_instance \
    bastilimbach/docker-magicmirror