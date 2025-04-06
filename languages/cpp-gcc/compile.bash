# May need to set env variable!
# Otherwise gcc could start complaining about being unable to find `cc1plus`
# On my (@webdev03) Fedora 41 system, I have to add this to the start of the command:
# COMPILER_PATH=/usr/libexec/gcc/x86_64-redhat-linux/14
g++ -save-temps=obj code.cpp
