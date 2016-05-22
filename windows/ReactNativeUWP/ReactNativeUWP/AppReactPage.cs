using ReactNative;
using ReactNative.Bridge;
using ReactNative.Modules.Core;
using ReactNative.Shell;
using ReactNative.UIManager;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ReactNativeUWP
{
    class AppReactPage : ReactPage
    {
        public override string MainComponentName
        {
            get
            {
                return "ReactNativeUWP";
            }
        }

        public override List<IReactPackage> Packages
        {
            get
            {
                return new List<IReactPackage>
                {
                    new MainReactPackage(),
                    new ReactNativeUWPShellPackage()
                };
            }
        }

        public override bool UseDeveloperSupport
        {
            get
            {
#if DEBUG
                return true;
#else
                return false;
#endif
            }
        }

        private class ReactNativeUWPShellPackage : IReactPackage
        {
            private const string AppID = "";
            private const string WinAppID = "";

            public IReadOnlyList<Type> CreateJavaScriptModulesConfig()
            {
                return new List<Type>(0);
            }

            public IReadOnlyList<INativeModule> CreateNativeModules(ReactContext reactContext)
            {
                return new List<INativeModule>(0);
            }

            public IReadOnlyList<IViewManager> CreateViewManagers(ReactContext reactContext)
            {
                return new List<IViewManager>(0);
            }
        }
    }
}
